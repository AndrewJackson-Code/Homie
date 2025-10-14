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

// Serve static files (the static frontend)
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Homie proxy server listening on http://localhost:${PORT}`);
});
