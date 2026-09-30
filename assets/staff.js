/* Role passwords unlock encrypted bundles; role selection alone grants nothing. */
(() => {
    "use strict";
    const prefix = "tvc-tools.staff.v1.";
    const epochKey = prefix + "logout";
    const roles = ["technician", "admin"];
    const $ = (id) => document.getElementById(id);
    const config = $("staff-config") ? JSON.parse($("staff-config").textContent) : null;
    let operation = 0;
    let unlocked = false;
    let bundle = null;
    let observedEpoch = read("localStorage", epochKey) || "0";
    let channel;

    function read(storage, key) {
        try { return window[storage].getItem(key); } catch { return null; }
    }
    function write(storage, key, value) {
        try { window[storage].setItem(key, value); return true; } catch { return false; }
    }
    function remove(storage, key) {
        try { window[storage].removeItem(key); } catch { /* Storage can be disabled. */ }
    }
    function key(role) { return prefix + role; }
    function clearSession() {
        roles.forEach((role) => remove("sessionStorage", key(role)));
    }
    function lock() {
        operation++;
        unlocked = false;
        bundle = null;
        if (!config) return;
        $("tool-frame").removeAttribute("srcdoc");
        $("tool-frame").src = "about:blank";
        $("tool-list").replaceChildren();
        $("tool-title").textContent = "";
        $("tools-panel").hidden = true;
        $("viewer").hidden = true;
        $("login-panel").hidden = false;
        $("password").value = "";
        $("login-button").disabled = !config.encrypted;
    }
    function remoteLogout() {
        observedEpoch = read("localStorage", epochKey) || "0";
        clearSession();
        lock();
        if ($("notice")) $("notice").textContent = "Logged out. Choose a user and enter its password to log in again.";
        if ($("login-message")) $("login-message").textContent = "";
    }
    function logout() {
        roles.forEach((role) => remove("localStorage", key(role)));
        clearSession();
        write("localStorage", epochKey, String(Date.now()) + Math.random());
        channel?.postMessage("logout");
        remoteLogout();
        location.replace("staff.html?logged-out=1");
    }
    $("logout")?.addEventListener("click", logout);
    try {
        channel = new BroadcastChannel(prefix + "logout");
        channel.onmessage = (event) => { if (event.data === "logout") remoteLogout(); };
    } catch { /* Storage events still handle other tabs where available. */ }
    window.addEventListener("storage", (event) => {
        if (event.key === null || event.key === epochKey ||
            (roles.some((role) => event.key === key(role)) && event.newValue === null)) {
            remoteLogout();
        }
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && (read("localStorage", epochKey) || "0") !== observedEpoch) remoteLogout();
    });
    if (new URLSearchParams(location.search).has("logged-out") && $("notice")) {
        $("notice").textContent = "Logged out of Technician and Admin on this browser.";
    }
    if (!config) return;

    $("role").value = config.role;
    $("role").addEventListener("change", () => {
        lock();
        location.assign($("role").value + ".html");
    });
    function showMenu() {
        $("viewer").hidden = true;
        $("tool-frame").removeAttribute("srcdoc");
        $("tool-frame").src = "about:blank";
        $("tools-panel").hidden = false;
    }
    $("back-to-tools").addEventListener("click", showMenu);
    function publish(data) {
        bundle = data;
        unlocked = true;
        $("login-panel").hidden = true;
        $("access-label").textContent = config.role === "admin" ? "Admin access includes all technician tools." : "Technician access";
        $("tool-list").replaceChildren();
        bundle.tools.forEach((tool) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "tool-button";
            const title = document.createElement("strong");
            title.textContent = tool.title;
            const description = document.createElement("small");
            description.textContent = tool.access === "admin" ? "Admin" : "Technician";
            button.append(title, description);
            button.addEventListener("click", () => {
                if (!unlocked) return;
                $("tools-panel").hidden = true;
                $("viewer").hidden = false;
                $("tool-title").textContent = tool.title;
                $("tool-frame").title = tool.title;
                $("tool-frame").srcdoc = tool.html;
            });
            $("tool-list").append(button);
        });
        showMenu();
    }
    async function decrypt(value, fromHash, remember) {
        const request = ++operation;
        const startedEpoch = read("localStorage", epochKey) || "0";
        $("login-button").disabled = true;
        $("login-message").textContent = "Unlocking…";
        let decoded;
        try {
            const engine = window.staticryptInitiator.init(config.encrypted, {
                replaceHtmlCallback: (text) => { decoded = text; },
            });
            const result = fromHash
                ? await engine.handleDecryptionOfPageFromHash(value, false)
                : await engine.handleDecryptionOfPage(value, false);
            if (request !== operation || startedEpoch !== (read("localStorage", epochKey) || "0")) return false;
            if (!result.isSuccessful) {
                if (fromHash) {
                    remove("localStorage", key(config.role));
                    remove("sessionStorage", key(config.role));
                }
                $("login-message").textContent = fromHash ? "Please enter your password again." : "Incorrect password for this user.";
                return false;
            }
            const data = JSON.parse(decoded);
            if (data.version !== 1 || data.role !== config.role || !Array.isArray(data.tools)) throw new Error("Invalid bundle");
            const credential = JSON.stringify({ hash: result.hashedPassword, epoch: startedEpoch });
            write("sessionStorage", key(config.role), credential);
            if (remember && !write("localStorage", key(config.role), credential)) {
                $("notice").textContent = "This browser could not save your login. You can still use the tools now.";
            } else {
                $("notice").textContent = "";
            }
            $("password").value = "";
            $("login-message").textContent = "";
            publish(data);
            return true;
        } catch {
            if (request === operation) $("login-message").textContent = "Unable to unlock this page. Please reload and try again.";
            return false;
        } finally {
            decoded = null;
            if (request === operation) $("login-button").disabled = false;
        }
    }
    async function restore() {
        if (!config.encrypted) {
            $("login-message").textContent = "Staff access is being set up. Passwords have not been configured yet.";
            return;
        }
        if (!window.isSecureContext || !window.crypto?.subtle || !window.staticryptInitiator) {
            $("login-message").textContent = "Login needs HTTPS (or localhost for a preview) and a supported browser.";
            return;
        }
        observedEpoch = read("localStorage", epochKey) || "0";
        $("login-button").disabled = false;
        $("login-message").textContent = "";
        for (const storage of ["localStorage", "sessionStorage"]) {
            const saved = read(storage, key(config.role));
            if (!saved) continue;
            try {
                const credential = JSON.parse(saved);
                if (credential.epoch === observedEpoch && typeof credential.hash === "string") {
                    await decrypt(credential.hash, true, storage === "localStorage");
                    return;
                }
            } catch { /* Ignore incomplete saved browser data. */ }
            remove(storage, key(config.role));
        }
    }
    $("login-form").addEventListener("submit", (event) => {
        event.preventDefault();
        if (config.encrypted && !$("login-button").disabled) decrypt($("password").value, false, $("remember").checked);
    });
    // Keep decrypted tools out of a restored Back/Forward cache entry.
    window.addEventListener("pagehide", lock);
    window.addEventListener("pageshow", (event) => { if (event.persisted) restore(); });
    restore();
})();
