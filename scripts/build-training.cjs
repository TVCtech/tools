"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {parse, serialize} = require("parse5");

const TYPES = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml"};
const ID = "calsis-160";
const sha = data => crypto.createHash("sha256").update(data).digest("hex");

function resolveResource(from, reference) {
    if (typeof reference !== "string" || reference.includes("\\") || reference.includes("\0")) throw new Error("Invalid training resource path.");
    const url = new URL(reference, "https://training.invalid/" + from);
    if (url.origin !== "https://training.invalid" || url.pathname === "/") throw new Error("Training resources must remain inside the package.");
    const resource = decodeURIComponent(url.pathname.slice(1));
    if (resource.split("/").some(part => part === ".." || part === "." || !part)) throw new Error("Invalid training resource path.");
    return resource;
}

function packPage(html, filename, available) {
    const document = parse(html);
    const scripts = [], styles = [];
    function walk(node) {
        const attr = name => node.attrs?.find(entry => entry.name === name)?.value;
        const set = (name, value) => { node.attrs = (node.attrs || []).filter(entry => entry.name !== name); node.attrs.push({name, value}); };
        const remove = name => { node.attrs = (node.attrs || []).filter(entry => entry.name !== name); };
        if (node.tagName === "script") {
            const source = attr("src");
            if (!source || (attr("type") && attr("type") !== "text/javascript")) throw new Error("Training scripts must be local classic scripts.");
            const target = resolveResource(filename, source);
            if (!available.has(target)) throw new Error("Missing training script.");
            if (!target.endsWith("/training-host.js")) scripts.push(target);
            return false;
        }
        if (node.tagName === "link" && attr("rel") === "stylesheet") {
            const target = resolveResource(filename, attr("href"));
            if (!available.has(target)) throw new Error("Missing training stylesheet.");
            styles.push(target);
            return false;
        }
        if (["iframe", "object", "embed", "base"].includes(node.tagName)) throw new Error("Unsupported embedded training resource.");
        if (node.tagName === "img" && attr("src")) {
            const source = attr("src");
            if (!available.has(resolveResource(filename, source))) throw new Error("Missing training picture.");
            set("data-training-src", source);
            remove("src");
        }
        if (attr("srcset")) throw new Error("Training srcset needs an explicit loader implementation.");
        if (node.tagName === "a" && attr("href")) {
            const href = attr("href");
            if (/^https:\/\//.test(href)) {
                set("target", "_blank"); set("rel", "noopener noreferrer");
            } else {
                if (!href.startsWith("#") && !available.has(resolveResource(filename, href))) throw new Error("Broken training page link.");
                set("data-training-link", href); set("href", "#");
            }
        }
        node.childNodes = (node.childNodes || []).filter(child => walk(child) !== false);
    }
    walk(document);
    return Buffer.from(JSON.stringify({html: serialize(document), scripts, styles}));
}

function encrypt(bytes, key, resource) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(ID + ":" + resource));
    return Buffer.concat([Buffer.from("TVC1"), iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}

function buildTraining({source, output, keys, configuration = {}}) {
    source = fs.realpathSync(source);
    const publicRoot = fs.realpathSync(path.resolve(__dirname, ".."));
    if (source === publicRoot || source.startsWith(publicRoot + path.sep)) throw new Error("Training source must remain outside the public repository.");
    const settings = JSON.parse(fs.readFileSync(path.join(source, "quiz/settings.json"), "utf8"));
    if (settings.questionsPerTest !== 20 || settings.showTestingTools || fs.existsSync(path.join(source, "quiz/testing-tools.js"))) throw new Error("Testing tools or a shortened test cannot be published.");
    const resources = new Map();
    function collect(directory) {
        for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
            if (item.isSymbolicLink()) throw new Error("Training resources cannot be symlinks.");
            const absolute = path.join(directory, item.name);
            if (item.isDirectory()) collect(absolute);
            else if (TYPES[path.extname(item.name)]) resources.set(path.relative(source, absolute).split(path.sep).join("/"), fs.readFileSync(absolute));
        }
    }
    collect(source);
    if (!resources.has("index.html")) throw new Error("Training landing page is missing.");
    const access = resources.has("access.json") ? JSON.parse(resources.get("access.json").toString("utf8")) : {version: 1, adminOnly: []};
    if (access.version !== 1 || !Array.isArray(access.adminOnly) || access.adminOnly.some(resource => typeof resource !== "string" || !resources.has(resource) || resolveResource("index.html", resource) !== resource)) throw new Error("Invalid training access configuration.");
    const adminOnly = new Set(access.adminOnly);
    for (const [filename, bytes] of resources) {
        if (filename.endsWith(".html")) resources.set(filename, packPage(bytes.toString("utf8"), filename, resources));
        if (filename.endsWith(".css") && /url\s*\(/i.test(bytes.toString("utf8"))) throw new Error("Training CSS asset URLs need explicit packaging.");
    }
    keys.trainingPackages ??= {};
    const state = keys.trainingPackages[ID] ??= {key: crypto.randomBytes(32).toString("hex"), cache: {}};
    if (!/^[a-f0-9]{64}$/.test(state.key)) throw new Error("Invalid private training key.");
    if (adminOnly.size) state.adminKey ??= crypto.randomBytes(32).toString("hex");
    if (adminOnly.size && !/^[a-f0-9]{64}$/.test(state.adminKey)) throw new Error("Invalid private admin training key.");
    const key = Buffer.from(state.key, "hex"), files = {}, manifest = {version: 1, id: ID, entry: "index.html", files: {}};
    function publish(bytes, resource, restricted = false) {
        const hash = sha(restricted ? Buffer.concat([Buffer.from("admin\0"), bytes]) : bytes), previous = state.cache[resource];
        let filename = previous?.hash === hash ? previous.file : null;
        let encrypted;
        if (filename && /^assets\/training\/calsis-160\/[a-f0-9]{64}\.bin$/.test(filename) && fs.existsSync(path.join(output, filename))) {
            encrypted = fs.readFileSync(path.join(output, filename));
            if (sha(encrypted) !== path.basename(filename, ".bin")) filename = null;
        } else filename = null;
        if (!filename) {
            encrypted = encrypt(bytes, restricted ? Buffer.from(state.adminKey, "hex") : key, resource);
            filename = "assets/training/" + ID + "/" + sha(encrypted) + ".bin";
        }
        files[filename] = encrypted;
        state.cache[resource] = {hash, file: filename};
        return filename;
    }
    for (const [resource, bytes] of resources) {
        const restricted = adminOnly.has(resource);
        manifest.files[resource] = {url: publish(bytes, resource, restricted), type: TYPES[path.posix.extname(resource)], ...(restricted ? {access: "admin"} : {})};
    }
    const manifestUrl = publish(Buffer.from(JSON.stringify(manifest)), "manifest");
    const profiles = configuration.accounts || {ss7: {company: "SubSea7"}, training: {company: null}, admin: {company: null}, technician: {company: null}};
    return {
        files,
        forAccount(account) {
            if (!Object.hasOwn(profiles, account.id)) return null;
            const profile = profiles[account.id];
            return {
                id: ID, label: "CALSIS 160 Training", key: state.key, manifest: manifestUrl,
                ...(account.id === "admin" && adminOnly.size ? {adminKey: state.adminKey} : {}),
                company: profile.company || null,
                recording: {enabled: Boolean(settings.resultsRecording?.enabled && configuration.endpoint && profile.token), endpoint: configuration.endpoint || null, token: profile.token || null},
            };
        },
    };
}

module.exports = {buildTraining, resolveResource, packPage};
