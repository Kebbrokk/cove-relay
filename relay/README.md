# Cove Relay

An **optional** little server that lets remote players join a Cove game when the
DM is behind a home router (NAT) and can't be reached directly. It is **not
needed for local or same-Wi-Fi play** — that's the built-in "Share on LAN"
feature (Phase 2), which needs no server at all. The relay is only for players
who aren't on the DM's network.

## What it does (and doesn't)

It is a **dumb pipe**. Both the DM's Cove app and the remote players connect
*out* to the relay (so neither needs to open a port), and the relay bridges them
by a short room code. It also serves the player's map page.

It holds **no game state**, does **no filtering**, and never sees your database.
The DM's app stays the single source of truth: it strips DM-only tokens and
drawings before anything leaves it, and computes each player's view. The relay
just forwards bytes. If you don't trust a relay operator, host your own — that's
the whole point of it being this small.

## Running it

```bash
cd relay
npm install
PORT=8080 npm start
```

It serves HTTP + WebSocket on `PORT` (default 8080). It reads the player page and
the browser modules from the repo's `../src`, so run it from within a checkout of
this repo (don't copy `server.js` out on its own).

**Put HTTPS in front of it.** Browsers require `wss://` (secure WebSockets) for
the player page to connect from a normal `https://` origin, and you don't want a
plaintext relay anyway. Terminate TLS with your platform's HTTPS (Fly.io, Render,
Railway, etc. give you this for free) or a reverse proxy (Caddy/nginx) in front
of the Node process.

Health check: `GET /healthz` → `{ "ok": true, "rooms": N }`.

## Pointing Cove at it

In Cove, open a campaign's **Maps** tab → **Remote…** → enter the relay's address
(e.g. `wss://your-relay.fly.dev`) → **Open Table**. Cove shows a room code and a
player link like `https://your-relay.fly.dev/r/ABCD`. Share that link (or the
code) with remote players; they open it in any browser.

## Protocol (for reference)

JSON messages over the `/ws` WebSocket. The relay routes; it never interprets
game data.

| From | Message | Meaning |
|------|---------|---------|
| host → relay | `{ t: 'host', room? }` | register as a room's host; relay assigns a code |
| relay → host | `{ t: 'hosted', room }` | room registered |
| relay → host | `{ t: 'seat-join' \| 'seat-leave', seat }` | a player joined/left |
| relay → host | `{ t: 'claim' \| 'release', seat, tokenId? }` | a player's claim, forwarded |
| host → relay | `{ t: 'state', seat, snapshot }` | a per-seat snapshot to route |
| seat → relay | `{ t: 'join', room, seat }` | join a room |
| relay → seat | `{ t: 'joined' \| 'no-room' }` | join result |
| seat → relay | `{ t: 'claim' \| 'release', tokenId? }` | claim/clear this seat's token |
| relay → seat | `{ t: 'snapshot', snapshot }` | routed from the host |
| relay → seat | `{ t: 'host-gone' }` | the DM closed the table |

For a friendly, step‑by‑step guide to obtaining, running, and deploying the
relay, see the [top‑level README](../README.md).
