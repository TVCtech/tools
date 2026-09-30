"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build, loadTools } = require("../scripts/build-staff.cjs");
const crypto = require("staticrypt/lib/cryptoEngine.js");
const codec = require("staticrypt/lib/codec.js").init(crypto);
const root = path.resolve(__dirname, "..");
// Public test fixtures, never credentials for the published site.
const passwords = { technician: "fixture-technician-password", admin: "fixture-admin-password" };

function config(directory, role) {
    const html = fs.readFileSync(path.join(directory, role + ".html"), "utf8");
    return JSON.parse(html.match(/<script id="staff-config" type="application\/json">(.*?)<\/script>/s)[1]);
}
async function unlock(config, password) {
    const data = config.encrypted;
    const salt = data.staticryptSaltUniqueVariableName;
    return codec.decode(data.staticryptEncryptedMsgUniqueVariableName, await crypto.hashPassword(password, salt), salt);
}

test("encrypted role boundaries, admin inheritance, retained salts and password changes", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tvc-staff-test-"));
    try {
        const source = path.join(temp, "source");
        const output = path.join(temp, "output");
        fs.cpSync(path.join(root, "examples/staff"), source, { recursive: true });
        await build({ source, output, passwords });
        const technician = config(output, "technician");
        const admin = config(output, "admin");
        assert.equal(fs.readFileSync(path.join(output, "users.html"), "utf8"), fs.readFileSync(path.join(output, "technician.html"), "utf8"));
        assert.deepEqual(JSON.parse((await unlock(technician, passwords.technician)).decoded).tools.map(t => t.id), ["technician-demo"]);
        assert.deepEqual(JSON.parse((await unlock(admin, passwords.admin)).decoded).tools.map(t => t.id), ["technician-demo", "admin-demo"]);
        assert.equal((await unlock(admin, passwords.technician)).success, false);
        for (const role of ["technician", "admin"]) {
            const raw = fs.readFileSync(path.join(output, role + ".html"), "utf8");
            assert.equal(raw.includes(passwords[role]), false);
            assert.equal(raw.includes("test page"), false);
            assert.equal(raw.includes("The admin tool is working"), false);
        }
        const salts = fs.readFileSync(path.join(output, "staff-salts.json"), "utf8");
        await build({ source, output, passwords: { ...passwords, admin: "changed-admin-fixture-password" } });
        assert.equal(fs.readFileSync(path.join(output, "staff-salts.json"), "utf8"), salts);
        assert.equal((await unlock(config(output, "admin"), passwords.admin)).success, false);
        assert.equal((await unlock(config(output, "admin"), "changed-admin-fixture-password")).success, true);
        assert.equal((await unlock(config(output, "technician"), passwords.technician)).success, true);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("private source must stay outside public repository; role passwords must differ", async () => {
    assert.throws(() => loadTools(path.join(root, "examples/staff")), /outside/);
    await assert.rejects(build({ source: "/unused", passwords: { admin: "same", technician: "same" } }), /different/);
});

test("invalid access and source traversal are rejected before writing", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tvc-staff-invalid-"));
    try {
        const source = path.join(temp, "source");
        fs.mkdirSync(source);
        const tool = { id: "example", title: "Example", access: "unknown", file: "../outside.html" };
        fs.writeFileSync(path.join(temp, "outside.html"), "Private fixture", "utf8");
        fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ tools: [tool] }), "utf8");
        assert.throws(() => loadTools(source), /access/);
        tool.access = "technician";
        fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ tools: [tool] }), "utf8");
        assert.throws(() => loadTools(source), /leave/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("private saved keys rebuild without passwords and reject stale or public keys", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tvc-private-keys-test-"));
    try {
        const source = path.join(temp, "source");
        const output = path.join(temp, "output");
        const keyFile = path.join(temp, "keys", "build-keys.json");
        fs.cpSync(path.join(root, "examples/staff"), source, { recursive: true });
        await build({ source, output, passwords, keyFile });
        const saved = fs.readFileSync(keyFile, "utf8");
        assert(!saved.includes(passwords.admin) && !saved.includes(passwords.technician));
        if (process.platform !== "win32") {
            assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
            assert.equal(fs.statSync(path.dirname(keyFile)).mode & 0o777, 0o700);
        }
        fs.appendFileSync(path.join(source, "admin-demo.html"), "<!-- revised private content -->", "utf8");
        await build({ source, output, keyFile });
        assert((await unlock(config(output, "admin"), passwords.admin)).decoded.includes("revised private content"));
        assert(!(await unlock(config(output, "technician"), passwords.technician)).decoded.includes("revised private content"));
        for (const role of ["admin", "technician"]) {
            const html = fs.readFileSync(path.join(output, role + ".html"), "utf8");
            assert(!html.includes(JSON.parse(saved).roles[role].hash));
        }
        await assert.rejects(build({ source, output, passwords, keyFile: path.join(root, "build-keys.json") }), /outside/);
        await assert.rejects(build({ source, output, passwords, keyFile: path.join(output, "build-keys.json") }), /outside/);
        if (process.platform !== "win32") {
            fs.chmodSync(keyFile, 0o644);
            await assert.rejects(build({ source, output, keyFile }), /owner/);
            fs.chmodSync(keyFile, 0o600);
        }
        // A password change elsewhere must not silently republish using an old key.
        await build({ source, output, passwords: { ...passwords, admin: "changed-key-test-password" } });
        const before = fs.readFileSync(path.join(output, "admin.html"), "utf8");
        await assert.rejects(build({ source, output, keyFile }), /no longer unlock/);
        assert.equal(fs.readFileSync(path.join(output, "admin.html"), "utf8"), before);
        await build({ source, output, passwords: { ...passwords, admin: "changed-key-test-password" }, keyFile });
        await build({ source, output, keyFile });
        assert((await unlock(config(output, "admin"), "changed-key-test-password")).success);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
