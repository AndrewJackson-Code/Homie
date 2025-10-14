const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());

// Logging toggle (default: enabled). Set LOGGING=0 or LOGGING=false to disable file logging.
const LOGGING_ENABLED = !(process.env.LOGGING === '0' || process.env.LOGGING === 'false');
if (!LOGGING_ENABLED) {
  console.log('LOGGING is disabled (LOGGING=0 or LOGGING=false). Proxmox request/response logging to logs/proxmox.jsonl is turned off.');
}

// Prepare logs path only when logging is enabled
const LOG_DIR = path.join(__dirname, 'logs');
let LOG_FILE = null;
if (LOGGING_ENABLED) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
  LOG_FILE = path.join(LOG_DIR, 'proxmox.jsonl');
}

function appendLog(obj) {
  if (!LOGGING_ENABLED) return; // no-op when logging disabled
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n');
  } catch (e) {
    console.warn('Failed to write proxmox log', e && e.toString());
  }
}

const PORT = process.env.PORT || 3000;
const PROXMOX_HOST = process.env.PROXMOX_HOST || 'aj-proxmox.duckdns.org';
const PROXMOX_TOKEN = process.env.PROXMOX_API_TOKEN || null;

if (!PROXMOX_TOKEN) {
  console.warn('Warning: PROXMOX_API_TOKEN not set in .env. Requests to Proxmox may fail.');
}

const PROXMOX_BASE = `https://${PROXMOX_HOST}:8006`;
// TLS handling options:
// - If PROXMOX_CA_FILE is set and points to a PEM file, that CA will be used to validate the server cert.
// - Otherwise, if PROXMOX_INSECURE=true, TLS validation will be disabled (insecure, for LAN/testing only).
const PROXMOX_INSECURE = (process.env.PROXMOX_INSECURE === '1' || process.env.PROXMOX_INSECURE === 'true');
const PROXMOX_CA_FILE = process.env.PROXMOX_CA_FILE || null;
let proxmoxAgent = undefined;
if (PROXMOX_CA_FILE) {
  try {
    const caPem = fs.readFileSync(PROXMOX_CA_FILE);
    proxmoxAgent = new https.Agent({ ca: caPem });
    console.log('Using custom Proxmox CA from', PROXMOX_CA_FILE);
  } catch (e) {
    console.warn('Unable to read PROXMOX_CA_FILE', PROXMOX_CA_FILE, e && e.toString());
  }
} else if (PROXMOX_INSECURE) {
  console.warn('Warning: PROXMOX_INSECURE=true — TLS certificate validation for Proxmox will be disabled. Use only for LAN/testing.');
  proxmoxAgent = new https.Agent({ rejectUnauthorized: false });
}

// Proxy endpoint for node status: /api/proxmox/nodes/:node/status
app.get('/api/proxmox/nodes/:node/status', async (req, res) => {
  const node = req.params.node;
  const url = `${PROXMOX_BASE}/api2/json/nodes/${encodeURIComponent(node)}/status`;
  try {
    const headers = {};
    if (PROXMOX_TOKEN) headers['Authorization'] = 'PVEAPIToken=' + PROXMOX_TOKEN;

    const fetchOpts = { headers };
    if (proxmoxAgent) fetchOpts.agent = proxmoxAgent;

    const proxRes = await fetch(url, fetchOpts);
    const text = await proxRes.text();

    // Log response (status, headers, and body snippet)
    appendLog({
      ts: new Date().toISOString(),
      url,
      route: '/api/proxmox/root',
      status: proxRes.status,
      headers: Object.fromEntries(proxRes.headers.entries ? proxRes.headers.entries() : []),
      body_snippet: (typeof text === 'string') ? text.slice(0, 2000) : null
    });

    res.status(proxRes.status).send(text);
  } catch (err) {
    appendLog({ ts: new Date().toISOString(), url, route: '/api/proxmox/root', error: err.toString() });
    res.status(500).json({ error: err.toString() });
  }
});

// Simple VM online check: /api/proxmox/vm/:vmid/online?node=NODE
app.get('/api/proxmox/vm/:vmid/online', async (req, res) => {
  const vmid = req.params.vmid;
  const node = req.query.node || 'pve-gamehost';
  const url = `${PROXMOX_BASE}/api2/json/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/status/current`;
  try {
    const headers = {};
    if (PROXMOX_TOKEN) headers['Authorization'] = 'PVEAPIToken=' + PROXMOX_TOKEN;

    const fetchOpts = { headers };
    if (proxmoxAgent) fetchOpts.agent = proxmoxAgent;

    const proxRes = await fetch(url, fetchOpts);
    const body = await proxRes.json().catch(() => null);

    appendLog({
      ts: new Date().toISOString(),
      url,
      route: '/api/proxmox/vm/:vmid/online',
      vmid,
      node,
      status: proxRes.status,
      body_snippet: body ? JSON.stringify(body).slice(0, 2000) : null
    });

    if (!body || !body.data) {
      return res.status(proxRes.status || 502).json({ vmid, node, online: false, status: 'unknown', proxmox_status: proxRes.status, body });
    }

    // Proxmox returns a 'status' field like 'running' or 'stopped'
    const vmStatus = body.data.status || (body.data.online ? 'running' : 'stopped');
    const online = vmStatus === 'running' || vmStatus === 'online';

    res.json({ vmid, node, online, status: vmStatus });
  } catch (err) {
    appendLog({ ts: new Date().toISOString(), url, route: '/api/proxmox/vm/:vmid/online', vmid, node, error: err.toString() });
    res.status(500).json({ error: err.toString() });
  }
});

// Optionally proxy root for raw fetch button
app.get('/api/proxmox/root', async (req, res) => {
  const url = `${PROXMOX_BASE}/`;
  try {
    const headers = {};
    if (PROXMOX_TOKEN) headers['Authorization'] = 'PVEAPIToken=' + PROXMOX_TOKEN;
    const fetchOpts = { headers };
    if (proxmoxAgent) fetchOpts.agent = proxmoxAgent;
    const proxRes = await fetch(url, fetchOpts);
    const text = await proxRes.text();

    appendLog({
      ts: new Date().toISOString(),
      url,
      route: '/api/proxmox/nodes/:node/status',
      node: req.params.node,
      status: proxRes.status,
      headers: Object.fromEntries(proxRes.headers.entries ? proxRes.headers.entries() : []),
      body_snippet: (typeof text === 'string') ? text.slice(0, 2000) : null
    });

    res.status(proxRes.status).send(text);
  } catch (err) {
    appendLog({ ts: new Date().toISOString(), url, route: '/api/proxmox/nodes/:node/status', node: req.params.node, error: err.toString() });
    res.status(500).json({ error: err.toString() });
  }
});

// Proxy endpoint for Podman container broadcast
// Fetches from the local python server using PODBROADCAST_API_KEY from .env
// and returns the JSON to the client without exposing the key.
app.get('/api/podman/containers', async (req, res) => {
  const key = process.env.PODBROADCAST_API_KEY || null;
  const target = `http://192.168.0.220:9191/?key=${encodeURIComponent(key || '')}`;
  if (!key) {
    appendLog({ ts: new Date().toISOString(), route: '/api/podman/containers', error: 'PODBROADCAST_API_KEY not configured' });
    return res.status(503).json({ error: 'PODBROADCAST_API_KEY not configured' });
  }

  try {
    const proxRes = await fetch(target, { cache: 'no-store' });
    const text = await proxRes.text();
    // Try to parse JSON, but fall back to raw text if parsing fails
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* ignore parse errors */ }

    // Scrub the API key from the logged URL to avoid writing secrets into logs.
    const scrubbedTarget = String(target).replace(/([?&]key=)[^&]*/i, '$1[REDACTED]');
    appendLog({
      ts: new Date().toISOString(),
      url: scrubbedTarget,
      route: '/api/podman/containers',
      status: proxRes.status,
      body_snippet: (typeof text === 'string') ? text.slice(0, 2000) : null
    });

    if (body !== null) {
      return res.json(body);
    }

    // If not valid JSON, proxy raw text with same status code
    return res.status(proxRes.status || 502).send(text);
  } catch (err) {
    appendLog({ ts: new Date().toISOString(), url: target, route: '/api/podman/containers', error: err.toString() });
    return res.status(500).json({ error: err.toString() });
  }
});

// Proxy endpoint for Tautulli "now playing" (What's streaming)
// Keeps TAUTULLI_API_KEY on the server and avoids exposing it to the client.
app.get('/api/tautulli/now_playing', async (req, res) => {
  const key = process.env.TAUTULLI_API_KEY || null;
  const host = process.env.TAUTULLI_HOST || '192.168.0.234:8181';
  if (!key) {
    appendLog({ ts: new Date().toISOString(), route: '/api/tautulli/now_playing', error: 'TAUTULLI_API_KEY not configured' });
    return res.status(503).json({ error: 'TAUTULLI_API_KEY not configured' });
  }

  // Use Tautulli v2 API endpoint. We intentionally call get_activity which returns current sessions.
  const target = `http://${host}/api/v2?apikey=${encodeURIComponent(key)}&cmd=get_activity`;

  try {
    const proxRes = await fetch(target, { cache: 'no-store' });
    const text = await proxRes.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* fall back to raw text */ }

    // Scrub API key before writing logs
    const scrubbedTarget = String(target).replace(/([?&]apikey=)[^&]*/i, '$1[REDACTED]');
    appendLog({
      ts: new Date().toISOString(),
      url: scrubbedTarget,
      route: '/api/tautulli/now_playing',
      status: proxRes.status,
      body_snippet: (typeof text === 'string') ? text.slice(0, 2000) : null
    });

    if (body !== null) {
      return res.json(body);
    }

    return res.status(proxRes.status || 502).send(text);
  } catch (err) {
    appendLog({ ts: new Date().toISOString(), url: target, route: '/api/tautulli/now_playing', error: err.toString() });
    return res.status(500).json({ error: err.toString() });
  }
});

// Block access to sensitive files and directories (dotfiles, logs, server source)
app.use((req, res, next) => {
  // Deny access to dotfiles, logs, and server/package sources
  const blockedExact = ['/server.js', '/package.json', '/package-lock.json', '/.env'];
  if (blockedExact.includes(req.path) || req.path.startsWith('/logs') || req.path.startsWith('/.')) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// Client-visible environment JS (safe values only; DO NOT expose secrets or tokens)
// Example response: window.HOMIE_ENV = { PROXMOX_CLIENT_API_BASE: "/api/proxmox", AI_ADDRESS: "https://..." };
app.get('/env.js', (req, res) => {
  const clientBase = process.env.PROXMOX_CLIENT_API_BASE || '/api/proxmox';
  const aiAddr = process.env.AI_ADDRESS || null;
  const payload = {
    PROXMOX_CLIENT_API_BASE: clientBase,
    AI_ADDRESS: aiAddr
  };
  res.set('Content-Type', 'application/javascript');
  // Do NOT include PROXMOX_API_TOKEN or any other secret here
  res.send(`window.HOMIE_ENV = ${JSON.stringify(payload)};`);
});

// Serve static files (the static frontend), but ignore dotfiles so .env cannot be downloaded
app.use(express.static(path.join(__dirname), { dotfiles: 'ignore' }));

app.listen(PORT, () => {
  console.log(`Homie proxy server listening on http://localhost:${PORT}`);
});
