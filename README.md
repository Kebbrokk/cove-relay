# Cove Relay

The optional helper server that lets **remote** players join a
[Cove](https://github.com/Kebbrokk/Cove) game when they are **not** on the game
master's Wi‑Fi.

This repository is a self‑contained, ready‑to‑run copy of the relay so you can
host your own — the main Cove app is private, so the pieces the relay needs to
run are published here for anyone who wants to run one.

> **Questions or trouble?** Email **[support@whitetailcove.com](mailto:support@whitetailcove.com)**.

---

## Table of contents

- [Do I even need this?](#do-i-even-need-this)
- [What the relay is (and isn't)](#what-the-relay-is-and-isnt)
- [What's in this repo](#whats-in-this-repo)
- [1. Get the relay](#1-get-the-relay)
- [2. Run it locally](#2-run-it-locally-to-try-it-out)
- [3. Put HTTPS in front of it](#3-put-https-in-front-of-it-required-for-real-play)
- [Deploy it to a host](#deploy-it-to-a-host)
  - [Fly.io](#flyio-recommended-free-https-scales-to-zero)
  - [Railway](#railway)
  - [Render](#render)
  - [Your own VPS with Caddy](#your-own-vps-with-caddy)
  - [Your own VPS with nginx](#your-own-vps-with-nginx)
- [4. Point Cove at your relay](#4-point-cove-at-your-relay)
- [Health check & monitoring](#health-check--monitoring)
- [Troubleshooting](#troubleshooting)
- [Protocol reference](#protocol-reference)
- [License](#license)

---

## Do I even need this?

Probably not for most games. The relay is **only** for players who are **not on
your local network**:

| How you play | Needs the relay? |
|---|---|
| Everyone at the same table (local) | ❌ No |
| Players on the same Wi‑Fi / LAN ("Share on LAN") | ❌ No |
| A player joining over the internet from another house | ✅ Yes |

If none of your players join from outside your network, you can ignore this
entire repository.

## What the relay is (and isn't)

The relay is a **dumb pipe**. Both your Cove app and your remote players connect
*out* to it, so **nobody has to open a port or forward anything** on their
router. It bridges the two by a short **room code**, and it serves the player's
map page.

It holds **no game state**, does **no filtering**, and never sees your notes or
database. Your Cove app stays the single source of truth: it strips DM‑only
tokens and drawings and computes each player's view *before* anything leaves it.
The relay just forwards bytes.

Because the relay is this small and sees nothing, **you can host your own and be
sure no one else is in the middle** — that's the whole point of it being this
tiny.

## What's in this repo

```
Cove-Relay/
├── relay/            ← the server itself
│   ├── server.js         the relay (HTTP + WebSocket)
│   ├── package.json      its one dependency: ws
│   ├── package-lock.json
│   ├── server.test.js    a tiny self-test
│   └── README.md         short technical notes + the wire protocol
├── src/              ← the player "seat" page the relay serves
│   ├── seat.html
│   ├── js/               seat.js, mapSurface.js, mapCamera.js, grid.js
│   ├── styles/main.css
│   └── assets/fonts/     the two brand fonts (optional; the page still works without them)
├── Dockerfile        ← one-command container build (Fly.io / Railway / Render / any Docker host)
├── fly.toml          ← ready-made Fly.io config
└── LICENSE
```

The `relay/` server reads the player page and browser modules from `../src`, so
**keep these two folders together** — don't copy `server.js` out on its own.

---

## 1. Get the relay

You need **[Node.js](https://nodejs.org) 18 or newer** installed (check with
`node --version`). Then get a copy of this repo:

**Option A — clone with git (easiest to update later):**

```bash
git clone https://github.com/Kebbrokk/Cove-Relay.git
cd Cove-Relay
```

**Option B — download a zip:** on this repo's GitHub page click the green
**Code** button → **Download ZIP**, then unzip it.

## 2. Run it locally (to try it out)

From inside the folder you just got:

```bash
cd relay
npm install        # fetches its one dependency (ws); only needed the first time
PORT=8080 npm start
```

You should see:

```
Cove relay listening on :8080
```

Any port works — `8080` is just the default. Confirm it's alive in another
terminal (or your browser):

```bash
curl http://localhost:8080/healthz
# {"ok":true,"rooms":0}
```

> **This local run is for testing only.** A browser will refuse to connect a
> player to a plain `http://` relay from Cove's secure page — you need HTTPS in
> front of it before real remote play works. See the next step.

Want to be sure the server is healthy? Run its self‑test:

```bash
cd relay
npm test
```

## 3. Put HTTPS in front of it (required for real play)

Browsers only allow **secure** WebSockets (`wss://`) from a secure (`https://`)
page, so the relay must sit behind TLS. You don't want a plaintext relay anyway.

You have two routes:

- **Easiest:** deploy to a host that gives you HTTPS for free — **Fly.io**,
  **Railway**, or **Render**. Pick one below and you're done in a few minutes.
- **Self‑managed:** run the Node process on your own machine/VPS and put a
  reverse proxy (**Caddy** or **nginx**) in front of it to terminate TLS.

---

## Deploy it to a host

All three hosted options below build from the included **`Dockerfile`**, so you
don't have to configure a runtime by hand — and each one hands you an HTTPS URL
automatically. Whichever you pick, the final address you give Cove will look
like `wss://your-app.<host>.dev`.

Before you start, push your copy of this repo to **your own** GitHub account (or
fork it) so the host can build from it.

### Fly.io (recommended: free HTTPS, scales to zero)

1. Install the CLI and sign in:
   ```bash
   # macOS/Linux
   curl -L https://fly.io/install.sh | sh
   fly auth signup     # or: fly auth login
   ```
2. From inside your `Cove-Relay` folder, launch it. A **`fly.toml`** is already
   included, so just deploy:
   ```bash
   fly launch --copy-config --name my-cove-relay --now
   ```
   - Pick a **unique** app name (`my-cove-relay` is taken — use your own).
   - If it asks about a database or Redis, say **no** — the relay needs neither.
   - It builds the `Dockerfile`, deploys, and prints your URL, e.g.
     `https://my-cove-relay.fly.dev`.
3. Your relay address for Cove is that URL with `wss://`:
   `wss://my-cove-relay.fly.dev`.

Re‑deploy after any change with `fly deploy`. The included config health‑checks
`/healthz` and lets the machine sleep when idle to save money; set
`min_machines_running = 1` in `fly.toml` if you'd rather avoid the ~1s cold
start when the first player connects.

### Railway

1. Create an account at [railway.app](https://railway.app).
2. **New Project → Deploy from GitHub repo**, and pick your `Cove-Relay` repo.
   Railway detects the `Dockerfile` and builds it automatically.
3. Open the service → **Settings → Networking → Generate Domain**. Railway
   assigns the public port for you (the relay honors Railway's `PORT`
   automatically — don't hard‑code one).
4. Your relay address is the generated domain with `wss://`, e.g.
   `wss://cove-relay-production.up.railway.app`.

### Render

1. Create an account at [render.com](https://render.com).
2. **New → Web Service**, connect your `Cove-Relay` repo.
3. Set **Runtime / Language** to **Docker** (Render detects the `Dockerfile`).
   Leave the start command blank — the image already runs the relay.
4. Add a **Health Check Path** of `/healthz` (Settings → Health & Alerts).
5. Deploy. Render gives you an HTTPS URL like
   `https://cove-relay.onrender.com`; your relay address is
   `wss://cove-relay.onrender.com`.

> On Render's free tier the service sleeps after inactivity and takes a few
> seconds to wake on the next connection — fine for casual games, or upgrade to
> keep it warm.

### Your own VPS with Caddy

If you have a server with a domain pointed at it, [Caddy](https://caddyserver.com)
gets you automatic HTTPS in two lines.

1. Run the relay (keep it alive with `pm2`, a systemd unit, or `tmux`):
   ```bash
   cd Cove-Relay/relay
   npm install
   PORT=8080 npm start
   ```
2. Create a `Caddyfile`:
   ```caddy
   relay.example.com {
       reverse_proxy localhost:8080
   }
   ```
3. `caddy run` (or `sudo caddy start`). Caddy fetches a certificate for
   `relay.example.com` and proxies HTTPS **and** the WebSocket upgrade through
   to the relay automatically. Your address is `wss://relay.example.com`.

### Your own VPS with nginx

1. Run the relay on `localhost:8080` as above.
2. Get a TLS certificate (e.g. `sudo certbot --nginx -d relay.example.com`).
3. Proxy HTTP **and** the WebSocket upgrade to it:
   ```nginx
   server {
       listen 443 ssl;
       server_name relay.example.com;

       ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

       location / {
           proxy_pass http://localhost:8080;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;      # required for WebSockets
           proxy_set_header Connection "upgrade";       # required for WebSockets
           proxy_set_header Host $host;
           proxy_read_timeout 3600s;                    # keep long-lived sockets open
       }
   }
   ```
4. `sudo nginx -s reload`. Your address is `wss://relay.example.com`.

The two `Upgrade`/`Connection` headers are the part people forget — without them
the WebSocket never connects and players sit at "Connecting…".

---

## 4. Point Cove at your relay

Once your relay answers over `wss://`:

1. In Cove, open a campaign's **Maps** tab and click **Remote…**.
2. Enter your relay's secure address (for example `wss://my-cove-relay.fly.dev`).
3. Click **Open Table**.

Cove shows a **room code** and a shareable **player link** like
`https://my-cove-relay.fly.dev/r/ABCD`. Hand that link (or just the code) to
your remote players — they open it in any browser, tap **"I'm playing…"**, and
claim their character's token.

One relay can host **many rooms at once** and can stay running between sessions.
Since it keeps no game data, restarting it simply drops any live tables — just
reopen **Remote…** in Cove for a fresh room code.

## Health check & monitoring

`GET /healthz` returns `{"ok":true,"rooms":N}` where `N` is the number of live
rooms. Point your host's health check (Fly/Render/Railway all support one) at
this path so the platform knows the relay is up.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Players stuck on **"Connecting…"** | The relay isn't reachable over `wss://`. Confirm the address starts with `wss://`, that `/healthz` responds over **https**, and (self‑hosted) that your proxy forwards the WebSocket `Upgrade`/`Connection` headers. |
| Cove says it can't reach the relay | You may have entered `https://` instead of `wss://`, or a typo in the host. The relay address is `wss://…`; the player *link* it prints is `https://…`. |
| `npm start` fails: **command not found: node** | Node.js isn't installed (or not on your PATH). Install Node 18+ from [nodejs.org](https://nodejs.org). |
| `EADDRINUSE` on start | Another process is already using that port. Start with a different one, e.g. `PORT=8090 npm start`. |
| Fonts/styles look plain in the player page | The `src/assets/fonts` files are optional; the page falls back to system fonts if they're missing. Keep the `src/` folder intact for the full look. |
| Everyone dropped after a restart/redeploy | Expected — the relay holds no state, so restarting drops live rooms. Reopen **Remote…** in Cove for a new code. |

Still stuck? Email **[support@whitetailcove.com](mailto:support@whitetailcove.com)**.

## Protocol reference

The relay routes a handful of tiny JSON messages over the `/ws` WebSocket and
never interprets game data. The full message table is in
[`relay/README.md`](relay/README.md).

## License

Cove Relay is part of the Cove project and is released under the
**GNU General Public License v3.0** — see [`LICENSE`](LICENSE).
