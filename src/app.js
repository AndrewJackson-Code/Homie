// Small app JS for the Homie starter page
// Features:
// - Theme toggle (light/dark) using a `dark` class on <html>
// - Proxmox fetch demo (uses fetch; will fail on private IP from a remote host but works locally)
// - Tiny game demo: click counter as placeholder

(function () {
    const html = document.documentElement;
    const themeToggleSwitch = document.getElementById('themeToggleSwitch');
    const themeToggleKnob = document.getElementById('themeToggleKnob');
    const aboutBtn = document.getElementById('aboutBtn');
    const blogDemo = document.getElementById('blogDemo');
    const startGame = document.getElementById('startGame');
    const scoreBtn = document.getElementById('scoreBtn');

    // Persist theme in localStorage
    const THEME_KEY = 'homie:theme';
    // Track whether the user explicitly selected a theme. If false, we follow system preference.
    let userPref = false;
    const prefersDarkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function loadTheme() {
        try {
            const t = localStorage.getItem(THEME_KEY);
            if (t === 'dark') {
                html.classList.add('dark');
                userPref = true;
            } else if (t === 'light') {
                html.classList.remove('dark');
                userPref = true;
            } else {
                // No explicit preference: follow system if available
                if (prefersDarkMQ) {
                    html.classList.toggle('dark', prefersDarkMQ.matches);
                } else {
                    html.classList.remove('dark');
                }
                userPref = false;
            }
        } catch (e) {
            // ignore
        }
    }
    loadTheme();

    // Sync the visual state of the new switch with the current theme
    function syncToggleUI() {
        const isDark = html.classList.contains('dark');
        if (!themeToggleSwitch) return;
        themeToggleSwitch.setAttribute('aria-checked', isDark ? 'true' : 'false');
        // Use Tailwind utility friendly classes for transform
        if (themeToggleKnob) {
            themeToggleKnob.classList.add('transition-transform');
            themeToggleKnob.classList.toggle('translate-x-6', isDark);
            themeToggleKnob.classList.toggle('translate-x-0', !isDark);
        }
        // adjust background for visual cue
        themeToggleSwitch.classList.toggle('bg-gray-700', isDark);
        themeToggleSwitch.classList.toggle('bg-gray-200', !isDark);
    }
    // Initial sync after load
    syncToggleUI();

    function toggleTheme() {
        const isDark = html.classList.toggle('dark');
        try {
            localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
            userPref = true;
        } catch (e) { }
        return isDark;
    }

    // Wrap toggleTheme to also update UI when used
    function handleToggleFromUI() {
        toggleTheme();
        syncToggleUI();
    }

    // Click and keyboard handlers for the switch
    if (themeToggleSwitch) {
        themeToggleSwitch.addEventListener('click', (ev) => {
            ev.preventDefault();
            handleToggleFromUI();
        });
        themeToggleSwitch.addEventListener('keydown', (ev) => {
            if (ev.key === ' ' || ev.key === 'Enter') {
                ev.preventDefault();
                handleToggleFromUI();
            }
        });
    }

    // If the user hasn't chosen a theme, respond to system changes
    if (prefersDarkMQ && !userPref) {
        prefersDarkMQ.addEventListener('change', (e) => {
            if (!userPref) {
                html.classList.toggle('dark', e.matches);
                syncToggleUI();
            }
        });
    }

    aboutBtn?.addEventListener('click', () => {
        alert('A personal Dashboard in Pure HTML, JS and CSS with a little help from TailwindCSS. Constantly updated, may not always be available.\n\nBy Andrew J.');
    });

    blogDemo?.addEventListener('click', () => {
        alert('Demo: blog link would open the blog section.');
    });

    // Proxmox fetch (demo) and node polling
    // Nodes configuration - using your public host (aj-proxmox.duckdns.org) on the default Proxmox API port 8006
    // Use local server proxy endpoints to avoid CORS and keep token on server
    const NODES = [
        { id: 'pve-master', label: 'pve-master', url: '/api/proxmox/nodes/pve-master/status' },
        { id: 'pve-gamehost', label: 'pve-gamehost', url: '/api/proxmox/nodes/pve-gamehost/status' },
        { id: 'pve-mac', label: 'pve-mac', url: '/api/proxmox/nodes/pve-mac/status' }
    ];

    // Polling state
    let pollTimer = null;
    const POLL_INTERVAL = 3000;

    // Podman polling (separate interval)
    let podmanTimer = null;
    const PODMAN_INTERVAL = 60000; // 60s

    function formatPct(v) { return (typeof v === 'number') ? v.toFixed(1) + '%' : '—'; }
    function nowShort() { return new Date().toLocaleTimeString(); }

    // Read token from window.PROXMOX_API_TOKEN or a meta tag (client-side only). For secure usage, prefer a server-side proxy.
    const TOKEN = window.PROXMOX_API_TOKEN || document.querySelector('meta[name="proxmox-token"]')?.getAttribute('content') || null;

    async function fetchNodeStatus(node) {
        const out = { ok: false };
        try {
            const headers = TOKEN ? { 'Authorization': 'PVEAPIToken=' + TOKEN } : {};
            const res = await fetch(node.url, { cache: 'no-store', headers });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            const data = json.data || json;
            // CPU
            const cpu = (data.cpu !== undefined) ? data.cpu * 100 : (data.cpu_usage !== undefined ? data.cpu_usage : null);
            // Memory: prefer memory.used/total, fallback to memory.free/total
            let memUsed = null, memTotal = null;
            if (data.memory && typeof data.memory === 'object') {
                memUsed = data.memory.used ?? null;
                memTotal = data.memory.total ?? null;
                // If only free/total, calculate used
                if (memUsed == null && data.memory.free != null && data.memory.total != null) {
                    memUsed = data.memory.total - data.memory.free;
                }
            } else {
                memUsed = data.mem_used ?? data.memory_used ?? null;
                memTotal = data.mem_total ?? data.memory_total ?? null;
            }
            const online = (data.online !== undefined) ? data.online : (data.status ? data.status === 'online' : true);

            out.ok = true;
            out.cpu = (typeof cpu === 'number') ? Math.min(100, cpu) : null;
            if (memUsed != null && memTotal) {
                out.memPct = (memUsed / memTotal) * 100;
                out.mem = { used: memUsed, total: memTotal };
            } else {
                out.memPct = null;
                out.mem = null;
            }
            out.online = online;
            out.raw = data;
        } catch (err) {
            out.ok = false;
            out.error = err.toString();
        }
        return out;
    }

    function updateNodeUI(id, result) {
        const statusEl = document.getElementById('status-' + id);
        const updatedEl = document.getElementById('updated-' + id);
        const cpuVal = document.getElementById('cpu-val-' + id);
        const cpuBar = document.getElementById('cpu-bar-' + id);
        const memVal = document.getElementById('mem-val-' + id);
        const memBar = document.getElementById('mem-bar-' + id);

        if (!statusEl) return;
        if (!result.ok) {
            statusEl.textContent = 'Offline';
            statusEl.className = 'text-red-500';
                if (updatedEl) updatedEl.textContent = 'Last updated: ' + nowShort();
            cpuVal.textContent = '—';
            memVal.textContent = '—';
            if (cpuBar) cpuBar.style.width = '0%';
            if (memBar) memBar.style.width = '0%';
            return;
        }

        statusEl.textContent = result.online ? 'Online' : 'Offline';
        statusEl.className = result.online ? 'text-green-500' : 'text-red-500';
            if (updatedEl) updatedEl.textContent = 'Last updated: ' + nowShort();

        if (result.cpu != null) {
            cpuVal.textContent = formatPct(result.cpu);
            if (cpuBar) cpuBar.style.width = Math.max(0, Math.min(100, result.cpu)) + '%';
        } else {
            cpuVal.textContent = '—';
            if (cpuBar) cpuBar.style.width = '0%';
        }

        if (result.memPct != null && result.mem) {
            // Show percentage and absolute values
            const usedGB = (result.mem.used / (1024 ** 3)).toFixed(1);
            const totalGB = (result.mem.total / (1024 ** 3)).toFixed(1);
            memVal.textContent = `${formatPct(result.memPct)} (${usedGB} GB / ${totalGB} GB)`;
            if (memBar) memBar.style.width = Math.max(0, Math.min(100, result.memPct)) + '%';
        } else {
            memVal.textContent = '';
            if (memBar) memBar.style.width = '0%';
        }
    }

    async function pollOnce() {
        for (const node of NODES) {
            const res = await fetchNodeStatus(node);
            updateNodeUI(node.id, res);
        }
    }

    // --- Podman containers poller ---
    async function fetchPodmanContainers() {
        try {
            const res = await fetch('/api/podman/containers', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const j = await res.json();
            return { ok: true, data: j };
        } catch (err) {
            return { ok: false, error: err.toString() };
        }
    }

    function renderPodmanContainers(containers) {
        const root = document.getElementById('podman-containers');
        const updated = document.getElementById('podman-updated');
        if (!root) return;
        root.innerHTML = '';
        if (!Array.isArray(containers)) {
            const el = document.createElement('div');
            el.className = 'col-span-1 p-4 rounded-lg bg-gray-50 dark:bg-gray-900';
            el.textContent = 'Unexpected response format';
            root.appendChild(el);
            if (updated) updated.textContent = 'Last updated: ' + nowShort();
            return;
        }

        containers.forEach(c => {
            // Normalize name and uptime/status fields
            const displayName = (Array.isArray(c.Names) && c.Names.length) ? c.Names[0] : (c.Name || c.Names || c.Id || 'container');
            const isRunning = c.State === 'running' || (c.Status && c.Status.toLowerCase().includes('up')) || (c.Online === true) || (c.ExitCode === 0 && !c.Exited);
            const statusText = isRunning ? (c.Status || 'Online') : (c.Status || 'Offline');
            const startedAt = c.StartedAt || c.Started || c.CreatedAt || null;

            // Card structure closely matching Proxmox node cards
            const card = document.createElement('div');
            card.className = 'rounded-lg p-4 bg-gray-50 dark:bg-gray-900';

            // Top area: title with status on the line below (match Proxmox layout)
            const top = document.createElement('div');
            top.className = 'flex items-start justify-between';
            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'text-sm font-semibold';
            title.textContent = displayName;

            // Status line (placed below the title). Prefix with 'Status: '
            const displayStatus = isRunning ? 'Online' : 'Offline';
            const statusLine = document.createElement('div');
            statusLine.className = 'mt-1 text-xs';
            const statusLabel = document.createElement('span');
            statusLabel.className = 'text-gray-600 dark:text-gray-400 font-medium';
            statusLabel.textContent = 'Status: ';
            const statusVal = document.createElement('span');
            statusVal.className = isRunning ? 'text-green-500' : 'text-red-500';
            statusVal.textContent = displayStatus;
            statusLine.appendChild(statusLabel);
            statusLine.appendChild(statusVal);

            left.appendChild(title);
            left.appendChild(statusLine);

            top.appendChild(left);
            card.appendChild(top);

            // Divider like Proxmox small separator
            const divider = document.createElement('div');
            divider.className = 'w-full h-px bg-gray-200 dark:bg-gray-800 my-3';
            card.appendChild(divider);

            // Bottom row: uptime and small updated timestamp
            const bottom = document.createElement('div');
            bottom.className = 'flex items-center justify-between text-xs text-gray-600 dark:text-gray-400';

            // Uptime: extract raw 'Up X' part if available
            let uptimeText = '—';
            if (c.Status && typeof c.Status === 'string') {
                const m = c.Status.match(/Up\s+[^()]*/i);
                uptimeText = m ? m[0].trim() : c.Status;
            } else if (startedAt) {
                uptimeText = startedAt;
            }
            const uptime = document.createElement('div');
            uptime.textContent = `${uptimeText}`;

            const updatedSmall = document.createElement('div');
            updatedSmall.className = 'text-xs text-gray-500 dark:text-gray-400';
            updatedSmall.textContent = nowShort();

            bottom.appendChild(uptime);
            //bottom.appendChild(updatedSmall);
            card.appendChild(bottom);
            root.appendChild(card);
        });

        if (updated) updated.textContent = 'Last updated: ' + nowShort();
    }

    async function pollPodmanOnce() {
        const res = await fetchPodmanContainers();
        if (!res.ok) {
            // render error card
            renderPodmanContainers([]);
            const root = document.getElementById('podman-containers');
            if (root) {
                root.innerHTML = '';
                const el = document.createElement('div');
                el.className = 'col-span-1 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm text-red-500';
                el.textContent = 'Error fetching podman containers: ' + res.error;
                root.appendChild(el);
            }
            const updated = document.getElementById('podman-updated');
            if (updated) updated.textContent = nowShort();
            return;
        }

        renderPodmanContainers(res.data);
    }

    function startPodmanPolling() {
        if (podmanTimer) return;
        pollPodmanOnce();
        podmanTimer = setInterval(pollPodmanOnce, PODMAN_INTERVAL);
    }

    // Start podman polling on DOM content loaded
    window.addEventListener('DOMContentLoaded', () => {
        startPodmanPolling();
    });

    function startPolling() {
        if (pollTimer) return;
        document.getElementById('startPolling')?.classList.add('hidden');
        document.getElementById('stopPolling')?.classList.remove('hidden');
        // Run immediately then every POLL_INTERVAL
        pollOnce();
        pollTimer = setInterval(pollOnce, POLL_INTERVAL);
    }

    function stopPolling() {
        if (!pollTimer) return;
        clearInterval(pollTimer);
        pollTimer = null;
        document.getElementById('startPolling')?.classList.remove('hidden');
        document.getElementById('stopPolling')?.classList.add('hidden');
    }

    document.getElementById('startPolling')?.addEventListener('click', startPolling);
    document.getElementById('stopPolling')?.addEventListener('click', stopPolling);

    // ...existing code...
    // Start polling automatically on page load
    window.addEventListener('DOMContentLoaded', () => {
        startPolling();
        // Start a lightweight VM-specific poller for Plex (vmid 108 on pve-gamehost)
        pollVmOnline('108', 5000);
    });

    scoreBtn?.addEventListener('click', () => {
        alert('Current demo score: ' + score + '\n(Click Start demo to play)');
    });

    // --- VM online poller ---
    // Polls the server endpoint /api/proxmox/vm/:vmid/online and updates
    // #status-vm-<vmid> and #updated-vm-<vmid>. Minimal and resilient.
    function setVmStatus(vmid, online, statusText) {
        const statusEl = document.getElementById('status-vm-' + vmid);
        const updatedEl = document.getElementById('updated-vm-' + vmid);
        if (!statusEl) return;
        statusEl.textContent = online ? 'Online' : 'Offline';
        statusEl.className = online ? 'text-green-500' : 'text-red-500';
        if (updatedEl) updatedEl.textContent = 'Last updated: ' + nowShort();
        // Optionally show status in title attribute
        statusEl.title = statusText || '';
    }

    // --- Tautulli "What's Streaming" integration ---
    const TAUTULLI_POLL_INTERVAL = 15000; // 15s
    let tautulliTimer = null;

    async function fetchTautulliNowPlaying() {
        try {
            const res = await fetch('/api/tautulli/now_playing', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const j = await res.json();
            return { ok: true, data: j };
        } catch (err) {
            return { ok: false, error: err.toString() };
        }
    }

    function renderTautulli(data) {
        const root = document.getElementById('tautulli-content');
        const updated = document.getElementById('tautulli-updated');
        if (!root) return;
        root.innerHTML = '';

        // Data shape: Tautulli v2 responses usually have 'response' with 'data' array under 'sessions' or similar.
        let sessions = [];
        try {
            if (!data) data = {};
            // Try common shapes
            if (Array.isArray(data.sessions)) sessions = data.sessions;
            else if (data.response && Array.isArray(data.response.data)) sessions = data.response.data;
            else if (data.response && data.response.data && Array.isArray(data.response.data.sessions)) sessions = data.response.data.sessions;
            else if (data.data && Array.isArray(data.data.sessions)) sessions = data.data.sessions;
        } catch (e) { sessions = []; }

        if (!sessions || sessions.length === 0) {
            const el = document.createElement('div');
            el.className = 'col-span-1 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-300';
            el.textContent = 'No active streams right now.';
            root.appendChild(el);
            if (updated) updated.textContent = 'Last updated: ' + nowShort();
            return;
        }

        sessions.forEach(s => {
            const card = document.createElement('div');
            card.className = 'rounded-lg p-4 bg-gray-50 dark:bg-gray-900';

            const top = document.createElement('div');
            top.className = 'flex items-start justify-between';
            const left = document.createElement('div');

            const title = document.createElement('div');
            title.className = 'text-sm font-semibold';
            // Try several fields for a friendly title
            title.textContent = s.title || s.grandparent_title || s.full_title || (s.movie_title || s.show_title) || 'Stream';

            const meta = document.createElement('div');
            meta.className = 'mt-1 text-xs text-gray-600 dark:text-gray-400';
            const who = document.createElement('span');
            who.className = 'font-medium';
            who.textContent = s.username || s.friendly_name || s.user || s.account || 'Unknown User';
            const separator = document.createElement('span');
            separator.className = 'mx-1';
            separator.textContent = '•';
            const device = document.createElement('span');
            device.textContent = s.player || s.device || s.platform || '';

            meta.appendChild(who);
            meta.appendChild(separator);
            meta.appendChild(device);

            left.appendChild(title);
            left.appendChild(meta);

            top.appendChild(left);

            const right = document.createElement('div');
            right.className = 'text-xs text-gray-500 dark:text-gray-400';
            right.textContent = nowShort();
            top.appendChild(right);

            card.appendChild(top);

            // progress / status row
            const progRow = document.createElement('div');
            progRow.className = 'mt-3 text-xs';
            const progressText = document.createElement('div');
            const progress = s.progress !== undefined ? `${s.progress}%` : (s.view_offset && s.duration ? `${Math.round((s.view_offset / s.duration) * 100)}%` : '—');
            progressText.textContent = `Progress: ${progress}`;
            progRow.appendChild(progressText);
            card.appendChild(progRow);

            root.appendChild(card);
        });

        if (updated) updated.textContent = 'Last updated: ' + nowShort();
    }

    async function pollTautulliOnce() {
        const res = await fetchTautulliNowPlaying();
        if (!res.ok) {
            const root = document.getElementById('tautulli-content');
            if (root) {
                root.innerHTML = '';
                const el = document.createElement('div');
                el.className = 'col-span-1 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm text-red-500';
                el.textContent = 'Error fetching streaming info: ' + res.error;
                root.appendChild(el);
            }
            const updated = document.getElementById('tautulli-updated');
            if (updated) updated.textContent = nowShort();
            return;
        }

        // Render with various tolerant shapes
        // If the API returned a wrapper like { response: { data: ... } }, pass that data through
        let payload = res.data;
        if (payload && payload.response && payload.response.data) payload = payload.response.data;
        renderTautulli(payload);
    }

    function startTautulliPolling() {
        if (tautulliTimer) return;
        pollTautulliOnce();
        tautulliTimer = setInterval(pollTautulliOnce, TAUTULLI_POLL_INTERVAL);
    }

    // Start Tautulli polling when DOM ready
    window.addEventListener('DOMContentLoaded', () => {
        startTautulliPolling();
    });

    async function pollVmOnline(vmid, intervalMs) {
        if (!vmid) return;
        const url = '/api/proxmox/vm/' + encodeURIComponent(vmid) + '/online';
        async function once() {
            try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const j = await res.json();
                const online = !!j.online;
                const status = j.status || (online ? 'running' : 'stopped');
                setVmStatus(vmid, online, status);
            } catch (err) {
                // On error, mark offline and store error as title
                setVmStatus(vmid, false, err.toString());
            }
        }
        // Run immediately and then interval
        once();
        setInterval(once, intervalMs || 5000);
    }

    // --- Miniature chat box handling (contacts remote AI) ---
    function safe$(id) { return document.getElementById(id); }

    function appendMiniMessage(who, text, opts) {
        // opts: { markdown: boolean }
        const container = safe$('mini-chat-messages');
        if (!container) return null;
        const wrapper = document.createElement('div');
        wrapper.className = who === 'user' ? 'text-right' : 'text-left';
        const bubble = document.createElement('div');
        bubble.className = 'inline-block max-w-[80%] px-3 py-1.5 rounded-md text-sm ' +
            (who === 'user' ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100');

        if (opts && opts.markdown && typeof window.marked === 'function' && window.DOMPurify) {
            // render markdown to HTML, then sanitize
            try {
                const rawHtml = window.marked.parse(text || '');
                bubble.innerHTML = window.DOMPurify.sanitize(rawHtml);
                // add classes for code blocks
                bubble.querySelectorAll('pre').forEach(p => p.classList.add('rounded', 'p-2', 'bg-gray-100', 'dark:bg-gray-800', 'text-xs', 'overflow-x-auto'));
            } catch (e) {
                bubble.textContent = text;
            }
        } else {
            bubble.textContent = text;
        }

        wrapper.appendChild(bubble);
        container.appendChild(wrapper);
        // keep scroll at bottom
        container.scrollTop = container.scrollHeight;
        return bubble;
    }

    async function sendToAiServer(userText) {
        // Uses an OpenAI-compatible Chat Completions endpoint
        // Endpoint: https://ajgpt.duckdns.org/v1/chat/completions
        // Payload: { model, messages } where messages is an array of { role, content }
        // Optional globals (set on window): AI_MODEL, AI_KEY
        const AI_ENDPOINT = 'https://ajgpt.duckdns.org/v1/chat/completions';
        const MODEL = window.AI_MODEL || 'gpt-4o-mini';
        const API_KEY = window.AI_KEY || null;

        const controller = new AbortController();
        const timeoutMs = 30000; // 30s for network + model generation
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (API_KEY) headers['Authorization'] = 'Bearer ' + API_KEY;

            const body = JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: 'You are a mini-chat assistant. Never use markdown, only ever use plain text. If the user asks for code, or a question which requires depth to answer, refuse to answer and kindly and warmly direct them to click the "Start Talking" button above to get in depth responses.' },
                    { role: 'user', content: userText }
                ],
                max_tokens: 512,
                temperature: 0.2
            });

            const res = await fetch(AI_ENDPOINT, {
                method: 'POST',
                headers,
                body,
                signal: controller.signal,
                cache: 'no-store'
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const ct = (res.headers.get('content-type') || '');
            if (ct.includes('application/json')) {
                const j = await res.json();
                // Try OpenAI-style response: choices[0].message.content
                const choice = Array.isArray(j.choices) && j.choices[0];
                const msg = choice?.message?.content ?? choice?.text ?? null;
                if (msg) return { ok: true, reply: msg };
                // Fallbacks
                if (j.reply) return { ok: true, reply: j.reply };
                return { ok: true, reply: JSON.stringify(j) };
            } else {
                const txt = await res.text();
                return { ok: true, reply: txt };
            }
        } catch (err) {
            clearTimeout(timer);
            return { ok: false, error: (err.name === 'AbortError') ? 'Request timed out' : err.toString() };
        }
    }

    // Wire up form if present
    window.addEventListener('DOMContentLoaded', () => {
        const form = safe$('mini-chat-form');
        const input = safe$('mini-chat-input');
        if (!form || !input) return;

        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const v = input.value.trim();
            if (!v) return;
            appendMiniMessage('user', v);
            input.value = '';

            // Show loading placeholder
            const loadingBubble = appendMiniMessage('ai', '…');
            try {
                const res = await sendToAiServer(v);
                if (loadingBubble) {
                    if (res.ok) {
                        // render markdown-safe HTML for AI replies
                        const parent = loadingBubble.parentElement;
                        const newBubble = appendMiniMessage('ai', res.reply, { markdown: true });
                        // remove loading bubble wrapper
                        if (parent && parent.parentElement) parent.parentElement.removeChild(parent);
                    } else {
                        loadingBubble.textContent = `Error: ${res.error}`;
                    }
                }
                if (!res.ok) console.error('AI fetch error:', res.error);
            } catch (err) {
                if (loadingBubble) loadingBubble.textContent = 'Error contacting AI';
                console.error('Unexpected AI error', err);
            }
        });
    });

})();
