# Homie
A Personal Dashboard and Home Page

---

# Features
- Simple modular panel like design
- Light and dark mode with coloured gradient accents per panel
- Links to personal blog (not created yet), Proxmox Cluster Info (192.168.0.210, JSON output only no interactivity), and Web Game Project.

## Environment variables

- LOGGING: When set to `0` or `false` the server will not write Proxmox request/response logs to `logs/proxmox.jsonl`. By default logging is enabled.

### Note
This is a personal project not intended for use within any other network, but could be adapted. Check server.js for hard coded local IPs if you want to use it.
