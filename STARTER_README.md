Homie — Tailwind + JS Starter

What I added
- index.html — Single page using Tailwind via the Play CDN. Contains a simple responsive dashboard layout with panels for Blog, Proxmox, and Web Game.
- src/app.js — Small JavaScript with theme toggle, a Proxmox JSON fetch demo (192.168.0.210), and a tiny click-based game demo.

Why this setup
- Uses Tailwind Play CDN to keep the starter zero-dependency and simple to open in a browser.
- Keeps JS minimal and in `src/app.js` for easy extension.

How to run
- Easiest: open `index.html` in your browser (double-click or use your editor's preview). Some features (like fetch to local network IP) require a server and proper network access.

Optional: serve with a simple HTTP server (recommended for `fetch` to work):

python3 -m http.server 8000

Then open http://localhost:8000 in your browser.

Notes
- The Proxmox fetch demo will attempt to GET `http://192.168.0.210/`. If that host is unreachable or CORS blocks the request, the output area will show the error.
- This is a minimal starter; feel free to ask for routing, bundling, or ESM conversion if you want to grow the project.

- UI tweak: the "AI Server" badge and action button are black in light mode and switch to white in dark mode for better contrast.
