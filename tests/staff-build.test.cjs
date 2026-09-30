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
