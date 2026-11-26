"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const {build} = require("../scripts/build-staff.cjs");
const {buildTraining, resolveResource} = require("../scripts/build-training.cjs");
const engine = require("staticrypt/lib/cryptoEngine.js"), codec = require("staticrypt/lib/codec.js").init(engine);
const root = path.resolve(__dirname, "..");
function fixture() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "tvc-training-test-"));
    const source = path.join(base, "course"), tools = path.join(base, "tools"), output = path.join(base, "site"), keyFile = path.join(base, "keys.json");
    fs.cpSync(path.join(root, "examples/staff"), tools, {recursive: true});
    fs.mkdirSync(path.join(source, "assets"), {recursive: true}); fs.mkdirSync(path.join(source, "quiz"));
    fs.writeFileSync(path.join(source, "quiz/settings.json"), JSON.stringify({questionsPerTest: 20, resultsRecording: {enabled: false}}));
    fs.writeFileSync(path.join(source, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="assets/style.css"></head><body><h1>PRIVATE-TRAINING-FIXTURE</h1><a href="module.html#part-2">Module</a><img src="assets/image.png"><script src="assets/training-host.js"></script><script src="assets/app.js"></script></body></html>');
    fs.writeFileSync(path.join(source, "module.html"), '<html><body><section id="part-2">Private module fixture</section></body></html>');
    fs.writeFileSync(path.join(source, "assets/style.css"), 'body { color: #123456; }');
    fs.writeFileSync(path.join(source, "assets/training-host.js"), '/* Local adapter fixture */');
    fs.writeFileSync(path.join(source, "assets/app.js"), 'window.privateFixture = true;');
    fs.writeFileSync(path.join(source, "assets/image.png"), 'PRIVATE-PICTURE-FIXTURE');
    fs.mkdirSync(path.join(source, "pdf"));
    fs.writeFileSync(path.join(source, "pdf/manual.pdf"), '%PDF-1.4\nPRIVATE-PDF-FIXTURE\n%%EOF');
    fs.appendFileSync(path.join(source, "index.html"), '<a href="pdf/manual.pdf" download="Manual.pdf">Download manual</a>');
    return {base, source, tools, output, keyFile};
}
function decrypt(data, key, resource) {
    assert.equal(data.subarray(0, 4).toString(), "TVC1");
    const cipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), data.subarray(4, 16));
    cipher.setAAD(Buffer.from("calsis-160:" + resource)); cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([cipher.update(data.subarray(16, -16)), cipher.final()]);
}
async function account(output, id, password) {
    const text = fs.readFileSync(path.join(output, id + ".html"), "utf8");
    const config = JSON.parse(text.match(/<script id="staff-config" type="application\/json">(.*?)<\/script>/s)[1]);
    const hash = await engine.hashPassword(password, config.encrypted.staticryptSaltUniqueVariableName);
    const result = await codec.decode(config.encrypted.staticryptEncryptedMsgUniqueVariableName, hash, config.encrypted.staticryptSaltUniqueVariableName);
    assert(result.success); return JSON.parse(result.decoded);
}
test("training stays encrypted, is available only to configured accounts and reuses unchanged assets", async () => {
    const f = fixture();
    try {
        const args = {source: f.tools, output: f.output, keyFile: f.keyFile, trainingSource: f.source};
        await build({...args, passwords: {technician: "fixture-technician-password", admin: "fixture-admin-password"}, companyAccounts: [
            {id: "ss7", label: "SS7", password: "fixture-ss7-password"}, {id: "ptl", label: "PTL", password: "fixture-ptl-password"},
        ]});
        const data = await account(f.output, "ss7", "fixture-ss7-password");
        assert.equal(data.training.company, "SubSea7");
        assert.equal((await account(f.output, "ptl", "fixture-ptl-password")).training, undefined);
        const manifest = JSON.parse(decrypt(fs.readFileSync(path.join(f.output, data.training.manifest)), data.training.key, "manifest"));
        const packed = JSON.parse(decrypt(fs.readFileSync(path.join(f.output, manifest.files["index.html"].url)), data.training.key, "index.html"));
        assert(!packed.html.includes('<script src='));
        assert(packed.html.includes('data-training-src="assets/image.png"'));
        assert(packed.html.includes('data-training-link="module.html#part-2"'));
        assert(packed.html.includes('href="pdf/manual.pdf" download="Manual.pdf"'));
        assert(!packed.html.includes('data-training-link="pdf/manual.pdf"'));
        assert.equal(resolveResource("technician/index.html", "../pdf/manual.pdf"), "pdf/manual.pdf");
        assert.equal(manifest.files["pdf/manual.pdf"].type, "application/pdf");
        const pdf = fs.readFileSync(path.join(f.output, manifest.files["pdf/manual.pdf"].url));
        assert.equal(decrypt(pdf, data.training.key, "pdf/manual.pdf").toString(), '%PDF-1.4\nPRIVATE-PDF-FIXTURE\n%%EOF');
        assert(!fs.existsSync(path.join(f.output, "pdf/manual.pdf")));
        assert.deepEqual(packed.scripts, ["assets/app.js"]);
        assert.deepEqual(packed.styles, ["assets/style.css"]);
        const image = fs.readFileSync(path.join(f.output, manifest.files["assets/image.png"].url));
        assert.equal(decrypt(image, data.training.key, "assets/image.png").toString(), "PRIVATE-PICTURE-FIXTURE");
        assert.throws(() => decrypt(image, data.training.key, "index.html"));
        const damaged = Buffer.from(image); damaged[20] ^= 1;
        assert.throws(() => decrypt(damaged, data.training.key, "assets/image.png"));
        assert(!fs.existsSync(path.join(f.output, "staff-accounts.json")));
        for (const filename of fs.readdirSync(path.join(f.output, "assets/training/calsis-160"))) {
            const encrypted = fs.readFileSync(path.join(f.output, "assets/training/calsis-160", filename));
            assert(!encrypted.includes(Buffer.from("PRIVATE-TRAINING-FIXTURE")));
            assert(!encrypted.includes(Buffer.from("PRIVATE-PICTURE-FIXTURE")));
            assert(!encrypted.includes(Buffer.from("PRIVATE-PDF-FIXTURE")));
        }
        await build(args);
        const next = await account(f.output, "ss7", "fixture-ss7-password");
        assert.equal(next.training.manifest, data.training.manifest);
        // A normal tools rebuild without the training source retains the existing course.
        await build({source: f.tools, output: f.output, keyFile: f.keyFile});
        assert.deepEqual((await account(f.output, "ss7", "fixture-ss7-password")).training, data.training);
    } finally { fs.rmSync(f.base, {recursive: true, force: true}); }
});
test("publication refuses shortened quizzes, debug tools, public source and broken resource links", () => {
    const f = fixture();
    try {
        assert.throws(() => buildTraining({source: root, output: f.output, keys: {}}), /outside/);
        fs.writeFileSync(path.join(f.source, "quiz/settings.json"), JSON.stringify({questionsPerTest: 5}));
        assert.throws(() => buildTraining({source: f.source, output: f.output, keys: {}}), /shortened/);
        fs.writeFileSync(path.join(f.source, "quiz/settings.json"), JSON.stringify({questionsPerTest: 20, showTestingTools: true}));
        assert.throws(() => buildTraining({source: f.source, output: f.output, keys: {}}), /Testing tools/);
        fs.writeFileSync(path.join(f.source, "quiz/settings.json"), JSON.stringify({questionsPerTest: 20}));
        fs.writeFileSync(path.join(f.source, "quiz/testing-tools.js"), "/* Forbidden debug file */");
        assert.throws(() => buildTraining({source: f.source, output: f.output, keys: {}}), /Testing tools/);
        fs.unlinkSync(path.join(f.source, "quiz/testing-tools.js"));
        fs.unlinkSync(path.join(f.source, "assets/image.png"));
        assert.throws(() => buildTraining({source: f.source, output: f.output, keys: {}}), /Missing training picture/);
    } finally { fs.rmSync(f.base, {recursive: true, force: true}); }
});
test("unlisted admin resources use a separate key and cannot reuse shared ciphertext", async () => {
    const f = fixture();
    try {
        const args = {source: f.tools, output: f.output, keyFile: f.keyFile, trainingSource: f.source};
        await build({...args, passwords: {technician: "fixture-technician-password", admin: "fixture-admin-password"}});
        const before = await account(f.output, "technician", "fixture-technician-password");
        const oldManifest = JSON.parse(decrypt(fs.readFileSync(path.join(f.output, before.training.manifest)), before.training.key, "manifest"));
        fs.writeFileSync(path.join(f.source, "access.json"), JSON.stringify({version: 1, adminOnly: ["module.html"]}));
        await build(args);
        const admin = await account(f.output, "admin", "fixture-admin-password");
        const technician = await account(f.output, "technician", "fixture-technician-password");
        assert.match(admin.training.adminKey, /^[a-f0-9]{64}$/);
        assert.equal(technician.training.adminKey, undefined);
        assert.equal(technician.training.key, before.training.key);
        const manifest = JSON.parse(decrypt(fs.readFileSync(path.join(f.output, admin.training.manifest)), admin.training.key, "manifest"));
        assert.equal(manifest.files["index.html"].url, oldManifest.files["index.html"].url);
        assert.notEqual(manifest.files["module.html"].url, oldManifest.files["module.html"].url);
        assert.equal(manifest.files["module.html"].access, "admin");
        const bytes = fs.readFileSync(path.join(f.output, manifest.files["module.html"].url));
        assert.throws(() => decrypt(bytes, technician.training.key, "module.html"));
        assert(JSON.parse(decrypt(bytes, admin.training.adminKey, "module.html")).html.includes("Private module fixture"));
        await build(args);
        assert.deepEqual((await account(f.output, "admin", "fixture-admin-password")).training, admin.training);
        fs.writeFileSync(path.join(f.source, "access.json"), JSON.stringify({version: 1, adminOnly: ["missing.html"]}));
        assert.throws(() => buildTraining({source: f.source, output: f.output, keys: {}}), /access configuration/);
    } finally { fs.rmSync(f.base, {recursive: true, force: true}); }
});
