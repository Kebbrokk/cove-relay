// relay/server.js
// The OPTIONAL relay for Phase 3 of the seat protocol: a tiny standalone server
// that lets a remote player reach a DM who is behind NAT/a home router, without
// port-forwarding. Both sides connect OUT to this relay; it bridges them by a
// short room code. LAN play (Phase 2) needs none of this - the relay is only for
// players who aren't on the same network.
//
// It is a DUMB PIPE: it holds no game state, does no filtering, and never
// touches a database. The DM's app remains the sole source of truth - it strips
// DM-only content before anything leaves it (see seatSnapshot.js) and computes
// each seat's private layer (see seatSession.js). The relay only routes:
//   host  <->  relay  <->  seats (remote player browsers)
//
// It also SERVES the player page and the browser-safe modules it needs, read
// straight from this repo's src/, so a relayed seat renders through the exact
// same code as the pop-out and the LAN seat - one renderer, no drift.
//
// Deploy: this file lives in the repo so it can serve src/. On any host (a small
// VPS, Fly.io, Render, etc.) run `node relay/server.js` with PORT set. Put TLS
// in front of it (the platform's HTTPS, or a reverse proxy) so seats connect
// over wss://. See relay/README.md.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

// Same static whitelist the LAN server uses; the player page (seat.html) is
// served for any /r/<code> path so the room code stays in the URL.
const STATIC_FILES = {
  '/js/seat.js': { file: 'js/seat.js', type: 'text/javascript; charset=utf-8' },
  '/js/mapSurface.js': { file: 'js/mapSurface.js', type: 'text/javascript; charset=utf-8' },
  '/js/mapCamera.js': { file: 'js/mapCamera.js', type: 'text/javascript; charset=utf-8' },
  '/js/grid.js': { file: 'js/grid.js', type: 'text/javascript; charset=utf-8' },
  '/styles/main.css': { file: 'styles/main.css', type: 'text/css; charset=utf-8' },
};

// Room-code alphabet: no 0/O/1/I so codes are easy to read aloud/type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map(); // code -> { host: ws, seats: Map(seatId -> ws) }

let httpServer = null;
let wss = null;

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function serveStatic(res, entry) {
  fs.readFile(path.join(SRC, entry.file), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': entry.type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function serveFont(res, pathname) {
  const name = pathname.slice('/assets/fonts/'.length);
  if (!/^[a-z0-9._-]+\.woff2$/i.test(name)) { res.writeHead(404); res.end(); return; }
  fs.readFile(path.join(SRC, 'assets', 'fonts', name), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' });
    res.end(data);
  });
}

function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  // The player page for a room: /r/<code>
  if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/r/'))) {
    serveStatic(res, { file: 'seat.html', type: 'text/html; charset=utf-8' });
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/assets/fonts/')) {
    serveFont(res, pathname);
    return;
  }
  if (req.method === 'GET' && STATIC_FILES[pathname]) {
    serveStatic(res, STATIC_FILES[pathname]);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}

// ---- WebSocket routing ----

function onHostMessage(ws, msg) {
  if (msg.t === 'host') {
    const code = (typeof msg.room === 'string' && rooms.has(msg.room)) ? msg.room : makeRoomCode();
    // Detach this socket from any prior role, then register as the room host.
    rooms.set(code, { host: ws, seats: new Map() });
    ws.__role = 'host';
    ws.__room = code;
    send(ws, { t: 'hosted', room: code });
    return;
  }
  const room = rooms.get(ws.__room);
  if (!room || room.host !== ws) return;

  if (msg.t === 'state' && msg.seat) {
    // Per-seat snapshot routed to that specific seat.
    send(room.seats.get(msg.seat), { t: 'snapshot', snapshot: msg.snapshot });
  } else if (msg.t === 'status' && msg.seat) {
    // Join status ('pending' | 'active' | 'denied') routed to that seat.
    send(room.seats.get(msg.seat), { t: 'status', status: msg.status });
  } else if (msg.t === 'kick' && msg.seat) {
    const seat = room.seats.get(msg.seat);
    if (seat) { send(seat, { t: 'kicked' }); room.seats.delete(msg.seat); }
  }
}

function onSeatMessage(ws, msg) {
  if (msg.t === 'join') {
    const room = rooms.get(msg.room);
    if (!room) { send(ws, { t: 'no-room' }); return; }
    ws.__role = 'seat';
    ws.__room = msg.room;
    ws.__seat = String(msg.seat || '');
    room.seats.set(ws.__seat, ws);
    send(ws, { t: 'joined', room: msg.room });
    // Pass the join metadata through so the host can prompt/label the seat.
    send(room.host, { t: 'seat-join', seat: ws.__seat, characterName: msg.characterName, connectionType: msg.connectionType || 'Remote' });
    return;
  }
  const room = rooms.get(ws.__room);
  if (!room) return;

  if (msg.t === 'claim') send(room.host, { t: 'claim', seat: ws.__seat, tokenId: msg.tokenId });
  else if (msg.t === 'release') send(room.host, { t: 'release', seat: ws.__seat });
  else if (msg.t === 'intent') send(room.host, { t: 'intent', seat: ws.__seat, intent: msg.intent });
}

function onClose(ws) {
  if (ws.__role === 'host' && ws.__room) {
    const room = rooms.get(ws.__room);
    if (room && room.host === ws) {
      for (const seat of room.seats.values()) send(seat, { t: 'host-gone' });
      rooms.delete(ws.__room);
    }
  } else if (ws.__role === 'seat' && ws.__room) {
    const room = rooms.get(ws.__room);
    if (room && room.seats.get(ws.__seat) === ws) {
      room.seats.delete(ws.__seat);
      send(room.host, { t: 'seat-leave', seat: ws.__seat });
    }
  }
}

function attachWs(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      // A socket's role is set by its first meaningful message ('host' or 'join')
      // and never switches, so hosts and seats can't cross-drive each other.
      if (ws.__role === 'host' || msg.t === 'host') onHostMessage(ws, msg);
      else onSeatMessage(ws, msg);
    });
    ws.on('close', () => onClose(ws));
    ws.on('error', () => { /* the close handler cleans up */ });
  });
}

export function startRelay({ port = Number(process.env.PORT) || 8080 } = {}) {
  if (httpServer) return Promise.resolve({ port: httpServer.address().port });
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handleHttp);
    srv.on('error', reject);
    srv.listen(port, () => {
      httpServer = srv;
      attachWs(srv);
      resolve({ port: srv.address().port });
    });
  });
}

export function stopRelay() {
  return new Promise((resolve) => {
    if (wss) { for (const c of wss.clients) { try { c.terminate(); } catch { /* ignore */ } } wss.close(); wss = null; }
    rooms.clear();
    if (httpServer) httpServer.close(() => { httpServer = null; resolve(); });
    else resolve();
  });
}

export function roomCount() {
  return rooms.size;
}

// Run directly (node relay/server.js) => start listening.
if (import.meta.url === `file://${process.argv[1]}`) {
  startRelay().then(({ port }) => console.log(`Cove relay listening on :${port}`));
}
