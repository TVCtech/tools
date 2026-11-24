/* Account passwords unlock encrypted tools and training; no customer directory is shown. */
(() => {
    "use strict";
    const prefix = "tvc-tools.staff.v1.", epochKey = prefix + "logout", lastKey = prefix + "last-account";
    const $ = id => document.getElementById(id);
    let config = $("staff-config") ? JSON.parse($("staff-config").textContent) : null;
    let operation = 0, unlocked = false, bundle = null, trainingViewer = null, channel;
    let observedEpoch = read("localStorage", epochKey) || "0";
    const accountId = () => config?.account || config?.role;
    const key = id => prefix + id;
    function read(storage, name) { try { return window[storage].getItem(name); } catch { return null; } }
    function write(storage, name, value) { try { window[storage].setItem(name, value); return true; } catch { return false; } }
    function remove(storage, name) { try { window[storage].removeItem(name); } catch { /* Storage can be disabled. */ } }
    function clearAccess(storage) {
        try { Object.keys(window[storage]).filter(name => name.startsWith(prefix) && name !== epochKey).forEach(name => remove(storage, name)); }
        catch { /* The current page still locks if storage is disabled. */ }
    }
    function setPasswordVisible(visible) {
        $("password").type = visible ? "text" : "password";
        $("show-password").textContent = visible ? "Hide" : "Show";
        $("show-password").setAttribute("aria-label", visible ? "Hide password" : "Show password");
        $("show-password").setAttribute("aria-pressed", String(visible));
    }
    function clearViewer() {
        trainingViewer?.close();
        $("tool-frame").removeAttribute("srcdoc"); $("tool-frame").src = "about:blank";
        $("tool-frame").setAttribute("sandbox", "allow-scripts allow-forms allow-downloads allow-modals");
    }
    function lock() {
        operation++; unlocked = false; bundle = null;
        if (!config) return;
        clearViewer(); $("tool-list").replaceChildren(); $("tool-title").textContent = "";
        $("tools-panel").hidden = true; $("viewer").hidden = true; $("login-panel").hidden = false;
        $("password").value = ""; setPasswordVisible(false); $("login-button").disabled = false;
    }
    function remoteLogout() {
        observedEpoch = read("localStorage", epochKey) || "0";
        clearAccess("sessionStorage"); lock();
        if ($("notice")) $("notice").textContent = "Logged out. Enter your account name and password to log in again.";
        if ($("login-message")) $("login-message").textContent = "";
    }
    function logout() {
        clearAccess("localStorage"); clearAccess("sessionStorage");
        write("localStorage", epochKey, String(Date.now()) + Math.random());
        channel?.postMessage("logout"); remoteLogout();
        location.replace("users.html?logged-out=1");
    }
    $("logout")?.addEventListener("click", logout);
    try { channel = new BroadcastChannel(prefix + "logout"); channel.onmessage = event => { if (event.data === "logout") remoteLogout(); }; }
    catch { /* Storage events also signal other tabs. */ }
    window.addEventListener("storage", event => {
        if (event.key === null || event.key === epochKey || (event.key?.startsWith(prefix) && event.newValue === null)) remoteLogout();
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && (read("localStorage", epochKey) || "0") !== observedEpoch) remoteLogout();
    });
    if (new URLSearchParams(location.search).has("logged-out") && $("notice")) $("notice").textContent = "Logged out of all accounts on this browser.";
    if (!config) return;
    $("show-password").addEventListener("click", () => setPasswordVisible($("password").type === "password"));
    $("role").value = accountId();
    $("role").addEventListener("input", () => { operation++; $("password").value = ""; setPasswordVisible(false); $("login-button").disabled = false; $("login-message").textContent = ""; });

    function showMenu(updateHistory = false) {
        clearViewer(); $("viewer").hidden = true; $("tools-panel").hidden = false;
        if (updateHistory && location.hash) history.pushState(null, "", location.pathname + location.search);
    }
    $("back-to-tools").addEventListener("click", () => showMenu(true));
    async function openTraining(path = "index.html", updateHistory = true) {
        if (!unlocked || !bundle?.training) return;
        const request = operation;
        $("tools-panel").hidden = true; $("viewer").hidden = false;
        $("tool-title").textContent = bundle.training.label;
        $("notice").textContent = "Opening training…";
        try {
            if (!trainingViewer) {
                const response = await fetch("assets/training-host.js?v=1");
                if (!response.ok) throw new Error("Training helper unavailable.");
                const helperText = await response.text();
                if (!unlocked || operation !== request) return;
                trainingViewer = new window.TVCTrainingViewer({frame: $("tool-frame"), accountId: accountId(), helperText, isUnlocked: () => unlocked});
            }
            await trainingViewer.open(bundle.training, path, updateHistory);
            if (unlocked && operation === request) $("notice").textContent = "";
        } catch {
            if (unlocked && operation === request) $("notice").textContent = "Training could not be opened. Return to the tools menu and try again.";
        }
    }
    function openRoute() {
        const route = new URLSearchParams(location.hash.slice(1));
        if (bundle?.training && route.get("training") === bundle.training.id) openTraining(route.get("page") || "index.html", false);
        else showMenu();
    }
    window.addEventListener("popstate", () => { if (unlocked) openRoute(); });
    function publish(data) {
        bundle = data; unlocked = true;
        trainingViewer?.destroy(); trainingViewer = null;
        $("login-panel").hidden = true;
        $("tools-panel").querySelector("h1").textContent = (config.accountLabel || config.role) + " tools";
        $("access-label").textContent = config.role === "admin" ? "Admin access includes all technician tools."
            : accountId() === "technician" ? "Technician access" : config.accountLabel + " · Technician access";
        $("tool-list").replaceChildren();
        function button(label, description, action, training = false) {
            const element = document.createElement("button"); element.type = "button"; element.className = "tool-button";
            if (training) element.dataset.training = "true";
            const title = document.createElement("strong"), detail = document.createElement("small");
            title.textContent = label; detail.textContent = description; element.append(title, detail);
            element.addEventListener("click", () => { if (unlocked) action(); });
            $("tool-list").append(element);
        }
        if (data.training) button(data.training.label, "Manuals and training test", () => openTraining(), true);
        const wheelLink = document.createElement("a");
        wheelLink.className = "tool-button";
        wheelLink.href = "Calsis160WheelSpacerCalc.html?user=" + encodeURIComponent(accountId());
        const wheelTitle = document.createElement("strong"), wheelDetail = document.createElement("small");
        wheelTitle.textContent = "CALSIS 160 Wheel Spacer Calculator";
        wheelDetail.textContent = "Open the wheel spacer calculator";
        wheelLink.append(wheelTitle, wheelDetail); $("tool-list").append(wheelLink);
        data.tools.forEach(tool => button(tool.title, tool.access === "admin" ? "Admin" : "Technician", () => {
            clearViewer(); $("tools-panel").hidden = true; $("viewer").hidden = false;
            if (config.role === "admin" && tool.id === "training-results-setup") $("tool-frame").setAttribute("sandbox", "allow-scripts allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox");
            $("tool-title").textContent = tool.title; $("tool-frame").title = tool.title; $("tool-frame").srcdoc = tool.html;
        }));
        openRoute();
    }
    async function selectedConfiguration(id) {
        if (!/^[a-z][a-z0-9-]{1,39}$/.test(id) || ["users", "staff", "index"].includes(id)) throw new Error("Invalid account.");
        if (id === accountId()) return config;
        const response = await fetch(id + ".html");
        if (!response.ok) throw new Error("Unknown account.");
        const text = await response.text();
        const match = text.match(/<script id="staff-config" type="application\/json">(.*?)<\/script>/s);
        const selected = match ? JSON.parse(match[1]) : null;
        if (!selected || (selected.account || selected.role) !== id || !["admin", "technician"].includes(selected.role)) throw new Error("Invalid account.");
        return selected;
    }
    async function decrypt(id, value, fromHash, remember) {
        const request = ++operation, startedEpoch = read("localStorage", epochKey) || "0";
        $("login-button").disabled = true; $("login-message").textContent = "Unlocking…";
        try {
            const selected = await selectedConfiguration(id);
            if (request !== operation) return false;
            if (!selected.encrypted) throw new Error("Not configured.");
            let decoded;
            const engine = window.staticryptInitiator.init(selected.encrypted, {replaceHtmlCallback: text => { decoded = text; }});
            const result = fromHash ? await engine.handleDecryptionOfPageFromHash(value, false) : await engine.handleDecryptionOfPage(value, false);
            if (request !== operation || startedEpoch !== (read("localStorage", epochKey) || "0")) return false;
            if (!result.isSuccessful) {
                if (fromHash) { remove("localStorage", key(id)); remove("sessionStorage", key(id)); }
                $("login-message").textContent = fromHash ? "Please enter your password again." : "Incorrect password for this user.";
                return false;
            }
            const data = JSON.parse(decoded);
            if (data.version !== 1 || data.role !== selected.role || (data.account || data.role) !== id || !Array.isArray(data.tools)) throw new Error("Invalid bundle.");
            config = selected;
            const credential = JSON.stringify({hash: result.hashedPassword, epoch: startedEpoch});
            write("sessionStorage", key(id), credential); write("sessionStorage", lastKey, id);
            if (remember) {
                if (!write("localStorage", key(id), credential)) $("notice").textContent = "This browser could not save your login. You can still use the tools now.";
                else { write("localStorage", lastKey, id); $("notice").textContent = ""; }
            } else $("notice").textContent = "";
            $("password").value = ""; $("login-message").textContent = "";
            publish(data); return true;
        } catch {
            if (request === operation) $("login-message").textContent = "Incorrect account name or password, or the page could not be loaded. Please try again.";
            return false;
        } finally { if (request === operation) $("login-button").disabled = false; }
    }
    async function restore() {
        if (!window.isSecureContext || !window.crypto?.subtle || !window.staticryptInitiator) {
            $("login-message").textContent = "Login needs HTTPS (or localhost for a preview) and a supported browser."; return;
        }
        observedEpoch = read("localStorage", epochKey) || "0";
        $("login-button").disabled = false; $("login-message").textContent = "";
        const generic = /\/(users|staff)\.html$/.test(location.pathname);
        const previous = read("localStorage", lastKey) || read("sessionStorage", lastKey);
        const id = generic && previous && /^[a-z][a-z0-9-]{1,39}$/.test(previous) ? previous : accountId();
        $("role").value = id;
        for (const storage of ["localStorage", "sessionStorage"]) {
            const saved = read(storage, key(id));
            if (!saved) continue;
            try {
                const credential = JSON.parse(saved);
                if (credential.epoch === observedEpoch && typeof credential.hash === "string") { await decrypt(id, credential.hash, true, storage === "localStorage"); return; }
            } catch { /* Ignore incomplete stored data. */ }
            remove(storage, key(id));
        }
    }
    $("login-form").addEventListener("submit", event => {
        event.preventDefault();
        if (!$("login-button").disabled) decrypt($("role").value.trim().toLowerCase(), $("password").value, false, $("remember").checked);
    });
    window.addEventListener("pagehide", lock);
    window.addEventListener("pageshow", event => { if (event.persisted) restore(); });
    restore();
})();
