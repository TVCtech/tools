/* Training page API. This generic helper contains no course content or login keys. */
(() => {
    "use strict";
    const context = window.__TVC_TRAINING_CONTEXT__;
    const localPrefix = "calsis160-training:";
    let port, sequence = 0;
    const pending = new Map(), pictures = new Map();
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    function request(operation, args, timeoutMs = 30000) {
        return ready.then(() => new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error("Training request timed out.")); }, timeoutMs);
            pending.set(id, {resolve, reject, timer});
            port.postMessage({id, operation, args});
        }));
    }
    function scrollToPanel(fragment) {
        const target = document.getElementById(decodeURIComponent(fragment.slice(1)));
        target?.scrollIntoView();
    }
    function pageUrl(reference) {
        return new URL(reference, "https://training.invalid/" + context.page);
    }
    const host = {
        adapterName: context ? "encrypted-host" : "local-preview",
        pageSearch: context ? new URL("https://training.invalid/" + context.page).search : location.search,
        async readStoredValue(key, fallbackValue) {
            if (context) return request("readStoredValue", {key, fallbackValue}).catch(() => fallbackValue);
            try { const value = localStorage.getItem(localPrefix + key); return value === null ? fallbackValue : JSON.parse(value); }
            catch { return fallbackValue; }
        },
        async writeStoredValue(key, value) {
            if (context) return request("writeStoredValue", {key, value}).catch(() => false);
            try { localStorage.setItem(localPrefix + key, JSON.stringify(value)); return true; }
            catch { return false; }
        },
        async submitAttempt(record) {
            if (!context) return {status: "not-configured", message: "Results are not recorded centrally yet."};
            return request("submitAttempt", {record}).catch(() => ({status: "failed", message: "The result could not be recorded. Tell your trainer."}));
        },
        async accountCompany() { return context?.company || null; },
        async readJson(relativePath) {
            if (context) return request("readJson", {path: relativePath});
            const response = await fetch(relativePath);
            if (!response.ok) throw new Error("Training data could not be loaded.");
            return response.json();
        },
        async assetUrl(relativePath) {
            if (!context) return relativePath;
            const absolute = pageUrl(relativePath).pathname;
            if (!pictures.has(absolute)) {
                const timeoutMs = absolute.toLowerCase().endsWith(".pdf") ? 180000 : 30000;
                const promise = request("asset", {path: relativePath}, timeoutMs)
                    .then(({bytes, type}) => URL.createObjectURL(new Blob([bytes], {type})))
                    .catch(error => { if (pictures.get(absolute) === promise) pictures.delete(absolute); throw error; });
                pictures.set(absolute, promise);
            }
            return pictures.get(absolute);
        },
        openPage(relativePath, options = {}) {
            if (!context) {
                if (options.newTab) window.open(relativePath, "_blank", "noopener");
                else location.href = relativePath;
                return;
            }
            const target = pageUrl(relativePath);
            if (target.origin !== "https://training.invalid") return;
            const destination = target.pathname.slice(1) + target.search + target.hash;
            if (options.newTab) {
                const viewer = new URL(context.viewerUrl);
                viewer.hash = new URLSearchParams({training: context.packageId, page: destination}).toString();
                window.open(viewer.href, "_blank", "noopener");
            } else if (target.pathname === pageUrl("").pathname && target.search === host.pageSearch && target.hash) {
                scrollToPanel(target.hash);
            } else request("openPage", {path: relativePath}).catch(showError);
        },
    };
    function showError() {
        let notice = document.getElementById("training-load-error");
        if (!notice) { notice = document.createElement("p"); notice.id = "training-load-error"; notice.setAttribute("role", "alert"); document.body.prepend(notice); }
        notice.textContent = "This training item could not be loaded. Return to Training home and try again.";
    }
    window.TrainingHost = host;
    if (!context) return;
    window.addEventListener("message", event => {
        if (event.source !== parent || event.origin !== context.hostOrigin || event.data?.type !== "tvc-training-init" || event.data.nonce !== context.nonce || port || !event.ports[0]) return;
        port = event.ports[0];
        port.onmessage = ({data}) => {
            const item = pending.get(data.id);
            if (!item) return;
            clearTimeout(item.timer); pending.delete(data.id);
            if (data.ok) item.resolve(data.value); else item.reject(new Error("Training request failed."));
        };
        resolveReady();
    });
    parent.postMessage({type: "tvc-training-ready", nonce: context.nonce}, context.hostOrigin);
    document.addEventListener("click", event => {
        if (event.defaultPrevented) return;
        const link = event.target.closest("a");
        if (!link) return;
        const target = link.dataset.trainingLink || link.getAttribute("href");
        if (!target || /^(https:|blob:|data:|mailto:)/i.test(target)) return;
        event.preventDefault();
        host.openPage(target, {newTab: link.target === "_blank" || event.ctrlKey || event.metaKey});
    });
    function loadPicture(image) {
        const source = image.dataset.trainingSrc;
        if (!source) return;
        delete image.dataset.trainingSrc;
        host.assetUrl(source).then(url => { image.src = url; }).catch(showError);
    }
    function initialisePictures() {
        const images = document.querySelectorAll("img[data-training-src]");
        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(entries => entries.forEach(entry => {
                if (entry.isIntersecting) { observer.unobserve(entry.target); loadPicture(entry.target); }
            }), {rootMargin: "700px"});
            images.forEach(image => observer.observe(image));
        } else images.forEach(loadPicture);
        const fragment = new URL("https://training.invalid/" + context.page).hash;
        if (fragment) requestAnimationFrame(() => scrollToPanel(fragment));
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialisePictures);
    else initialisePictures();
    window.addEventListener("pagehide", () => {
        port?.close();
        pictures.forEach(promise => promise.then(url => URL.revokeObjectURL(url)).catch(() => {}));
        pending.forEach(item => { clearTimeout(item.timer); item.reject(new Error("Training page closed.")); });
        pending.clear();
    });
})();
