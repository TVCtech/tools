/* Authenticated host for separately encrypted training resources. */
(() => {
    "use strict";
    const decoder = new TextDecoder(), encoder = new TextEncoder();
    const htmlSafe = text => text.replaceAll("</script", "<\\/script");
    const MIME = new Set(["text/html", "text/javascript", "text/css", "application/json", "application/pdf", "image/webp", "image/png", "image/jpeg", "image/svg+xml"]);
    function resourcePath(page, reference) {
        if (typeof reference !== "string" || reference.includes("\\") || reference.includes("\0")) throw new Error("Invalid resource.");
        const target = new URL(reference, "https://training.invalid/" + page);
        if (target.origin !== "https://training.invalid") throw new Error("External resource.");
        return {path: decodeURIComponent(target.pathname.slice(1)), destination: target.pathname.slice(1) + target.search + target.hash};
    }
    class TrainingViewer {
        constructor({frame, accountId, helperText, isUnlocked}) {
            this.frame = frame; this.accountId = accountId; this.helperText = helperText; this.isUnlocked = isUnlocked;
            this.generation = 0; this.cache = new Map(); this.controllers = new Set();
            this.readyListener = event => this.handshake(event);
            window.addEventListener("message", this.readyListener);
        }
        close() {
            this.generation++; this.port?.close(); this.port = null;
            this.controllers.forEach(controller => controller.abort()); this.controllers.clear();
            this.descriptor = null; this.manifest = null; this.key = null; this.adminKey = null; this.cache.clear();
            this.frame.removeAttribute("srcdoc"); this.frame.src = "about:blank";
            this.frame.setAttribute("sandbox", "allow-scripts allow-forms allow-downloads allow-modals");
        }
        destroy() {
            this.close();
            window.removeEventListener("message", this.readyListener);
        }
        async fetchBytes(url) {
            const target = new URL(url, document.baseURI);
            const root = new URL("assets/training/calsis-160/", document.baseURI);
            if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) throw new Error("Invalid encrypted resource URL.");
            const controller = new AbortController(); this.controllers.add(controller);
            try {
                const response = await fetch(target, {signal: controller.signal});
                if (!response.ok) throw new Error("Encrypted resource unavailable.");
                return new Uint8Array(await response.arrayBuffer());
            } finally { this.controllers.delete(controller); }
        }
        async decrypt(url, resource) {
            const data = await this.fetchBytes(url);
            if (decoder.decode(data.slice(0, 4)) !== "TVC1" || data.length < 32) throw new Error("Invalid encrypted resource.");
            const key = this.manifest?.files[resource]?.access === "admin" ? this.adminKey : this.key;
            return new Uint8Array(await crypto.subtle.decrypt({name: "AES-GCM", iv: data.slice(4, 16), additionalData: encoder.encode(this.descriptor.id + ":" + resource)}, key, data.slice(16)));
        }
        resourceEntry(path) {
            const entry = this.manifest?.files[path];
            if (!entry || !MIME.has(entry.type)) throw new Error("Unknown training resource.");
            if (entry.access && (entry.access !== "admin" || this.accountId !== "admin" || !this.adminKey)) throw new Error("This page requires the Admin login.");
            return entry;
        }
        async resource(path) {
            const entry = this.resourceEntry(path);
            if (!this.cache.has(path)) {
                const promise = this.decrypt(entry.url, path).catch(error => { this.cache.delete(path); throw error; });
                this.cache.set(path, promise);
                if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value);
            }
            return this.cache.get(path);
        }
        async open(descriptor, page = "index.html", updateHistory = true) {
            const generation = ++this.generation;
            this.port?.close();
            this.descriptor = descriptor;
            if (!this.manifest || !this.key || this.packageId !== descriptor.manifest) {
                this.cache.clear(); this.manifest = null;
                this.packageId = descriptor.manifest;
                const bytes = Uint8Array.from(descriptor.key.match(/../g), pair => parseInt(pair, 16));
                this.key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
                this.adminKey = descriptor.adminKey && this.accountId === "admin" ? await crypto.subtle.importKey("raw", Uint8Array.from(descriptor.adminKey.match(/../g), pair => parseInt(pair, 16)), "AES-GCM", false, ["decrypt"]) : null;
                this.manifest = JSON.parse(decoder.decode(await this.decrypt(descriptor.manifest, "manifest")));
                if (this.manifest.version !== 1 || this.manifest.id !== descriptor.id) throw new Error("Invalid training manifest.");
            }
            const target = resourcePath("index.html", page);
            if (this.manifest.files[target.path]?.type !== "text/html") throw new Error("Unknown training page.");
            const packed = JSON.parse(decoder.decode(await this.resource(target.path)));
            const styles = await Promise.all(packed.styles.map(async source => decoder.decode(await this.resource(source))));
            const scripts = await Promise.all(packed.scripts.map(async source => decoder.decode(await this.resource(source))));
            if (generation !== this.generation || !this.isUnlocked()) return;
            this.page = target.destination;
            this.nonce = crypto.randomUUID();
            const context = {page: this.page, packageId: descriptor.id, nonce: this.nonce, hostOrigin: location.origin, viewerUrl: new URL(this.accountId + ".html", document.baseURI).href, company: descriptor.company};
            const policy = "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src blob: data:; connect-src 'none'; form-action 'none'";
            let html = packed.html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${styles.join("\n").replaceAll("</style", "<\\/style")}</style>`);
            html = html.replace("</body>", `<script>window.__TVC_TRAINING_CONTEXT__=${JSON.stringify(context).replaceAll("<", "\\u003c")};\n${htmlSafe(this.helperText)}</script>${scripts.map(script => `<script>${htmlSafe(script)}</script>`).join("")}</body>`);
            this.frame.setAttribute("sandbox", "allow-scripts allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox");
            this.frame.srcdoc = html;
            if (updateHistory) history.pushState(null, "", "#" + new URLSearchParams({training: descriptor.id, page: this.page}));
        }
        handshake(event) {
            if (!this.isUnlocked() || !this.descriptor || event.source !== this.frame.contentWindow || event.data?.type !== "tvc-training-ready" || event.data.nonce !== this.nonce) return;
            const channel = new MessageChannel(); this.port?.close(); this.port = channel.port1;
            const generation = this.generation;
            channel.port1.onmessage = async ({data}) => {
                if (generation !== this.generation || !this.isUnlocked()) return;
                try {
                    const value = await this.dispatch(data.operation, data.args || {});
                    if (generation === this.generation && this.isUnlocked()) channel.port1.postMessage({id: data.id, ok: true, value});
                } catch { if (generation === this.generation) channel.port1.postMessage({id: data.id, ok: false}); }
            };
            this.frame.contentWindow.postMessage({type: "tvc-training-init", nonce: this.nonce}, "*", [channel.port2]);
        }
        storageKey(key) {
            if (typeof key !== "string" || !/^[a-zA-Z0-9:_-]{1,80}$/.test(key)) throw new Error("Invalid storage key.");
            return "tvc-tools.training.v1." + this.accountId + "." + this.descriptor.id + "." + key;
        }
        async dispatch(operation, args) {
            if (operation === "readStoredValue") {
                const key = this.storageKey(args.key);
                try { const value = localStorage.getItem(key); return value === null ? args.fallbackValue : JSON.parse(value); }
                catch { return args.fallbackValue; }
            }
            if (operation === "writeStoredValue") {
                const key = this.storageKey(args.key), text = JSON.stringify(args.value);
                if (text.length > 10000) throw new Error("Stored value too large.");
                try { localStorage.setItem(key, text); return true; } catch { return false; }
            }
            if (operation === "openPage") {
                const target = resourcePath(this.page, args.path);
                if (this.resourceEntry(target.path).type !== "text/html") throw new Error("Unknown training page.");
                return this.open(this.descriptor, target.destination);
            }
            if (operation === "submitAttempt") return this.submit(args.record);
            const target = resourcePath(this.page, args.path);
            const entry = this.manifest.files[target.path];
            if (operation === "readJson" && entry?.type === "application/json") return JSON.parse(decoder.decode(await this.resource(target.path)));
            if (operation === "asset" && (entry?.type.startsWith("image/") || entry?.type === "application/pdf")) return {bytes: await this.resource(target.path), type: entry.type};
            throw new Error("Unsupported training request.");
        }
        async submit(record) {
            const configuration = this.descriptor.recording;
            if (!configuration?.enabled || !configuration.endpoint || !configuration.token) return {status: "not-configured", message: "Results are not recorded centrally yet."};
            const endpoint = new URL(configuration.endpoint);
            if (endpoint.origin !== "https://script.google.com" || !/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname)) throw new Error("Invalid results address.");
            try {
                const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "text/plain;charset=UTF-8"}, body: JSON.stringify({version: 1, account: this.accountId, token: configuration.token, record}), signal: AbortSignal.timeout(25000)});
                if (!response.ok) throw new Error("Recording failed.");
                const receipt = await response.json();
                if (receipt.attemptId !== record.attemptId || receipt.eventStatus !== record.status || !["saved", "failed"].includes(receipt.status)) throw new Error("Invalid recording receipt.");
                return {status: receipt.status, message: receipt.message || ""};
            } catch { return {status: "failed", message: "Recording could not be confirmed. Tell your trainer."}; }
        }
    }
    window.TVCTrainingViewer = TrainingViewer;
})();
