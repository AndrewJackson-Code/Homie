// Small app JS for the Homie starter page
// Features:
// - Theme toggle (light/dark) using a `dark` class on <html>
// - Proxmox fetch demo (uses fetch; will fail on private IP from a remote host but works locally)
// - Tiny game demo: click counter as placeholder

(function () {
    const html = document.documentElement;
    const themeToggle = document.getElementById('themeToggle');
    const aboutBtn = document.getElementById('aboutBtn');
    // ...existing code...
    const blogDemo = document.getElementById('blogDemo');
    const startGame = document.getElementById('startGame');
    const scoreBtn = document.getElementById('scoreBtn');

    // Persist theme in localStorage
    const THEME_KEY = 'homie:theme';
    function loadTheme() {
        try {
            const t = localStorage.getItem(THEME_KEY);
            if (t === 'dark') html.classList.add('dark');
            else html.classList.remove('dark');
        } catch (e) {
            // ignore
        }
    }
    loadTheme();

    function toggleTheme() {
        const isDark = html.classList.toggle('dark');
        try { localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light'); } catch (e) { }
    }

    themeToggle?.addEventListener('click', toggleTheme);

    aboutBtn?.addEventListener('click', () => {
        alert('Homie — personal dashboard starter. Panels are placeholders.');
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
            updatedEl.textContent = nowShort();
            cpuVal.textContent = '—';
            memVal.textContent = '—';
            if (cpuBar) cpuBar.style.width = '0%';
            if (memBar) memBar.style.width = '0%';
            return;
        }

        statusEl.textContent = result.online ? 'Online' : 'Offline';
        statusEl.className = result.online ? 'text-green-500' : 'text-red-500';
        updatedEl.textContent = nowShort();

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
    });

    // Tiny game: click counter
    let score = 0;
    startGame?.addEventListener('click', () => {
        score = 0;
        const play = confirm('Start click demo? Click OK rapidly to increase score for 3 seconds.');
        if (!play) return;
        const start = Date.now();

        const clickHandler = () => { score++; };
        document.addEventListener('click', clickHandler);

        setTimeout(() => {
            document.removeEventListener('click', clickHandler);
            alert('Time up! Your score: ' + score);
        }, 3000);
    });

    scoreBtn?.addEventListener('click', () => {
        alert('Current demo score: ' + score + '\n(Click Start demo to play)');
    });
})();
