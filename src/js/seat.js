// seat.js
// Browser renderer for a player's "seat" (src/seat.html), served over the LAN
// by the DM's app (see electron/seatServer.js). A player on the same Wi-Fi
// opens the DM's URL and gets THIS page: the same live map the DM is running,
// on their own phone/tablet/laptop.
//
// It renders through the exact shared layers the DM's editor and the streaming
// pop-out use (mapSurface.js) and drives them with the shared camera
// (mapCamera.js), so the picture can't drift between the table and a remote
// device. It is view-only (Phase 2): it receives snapshots over Server-Sent
// Events and never sends game changes back. The only thing a seat "chooses" is
// which token is its own, so this device can highlight it and show its stats -
// a preference, not a game edit.

import { renderMapSurface, buildGridSvg, imageAspectRatio } from '/js/mapSurface.js';
import { MapCamera } from '/js/mapCamera.js';

const titleEl = document.getElementById('seatTitle');
const statusEl = document.getElementById('seatStatus');
const stage = document.getElementById('stage');
const cameraEl = document.getElementById('camera');
const emptyEl = document.getElementById('empty');
const panelEl = document.getElementById('panel');
const claimOverlay = document.getElementById('claimOverlay');
const claimList = document.getElementById('claimList');

// A stable per-device id so the server can remember which token this seat
// claimed across reloads/reconnects.
const SEAT_KEY = 'cove.seatId';
function seatId() {
  let id = localStorage.getItem(SEAT_KEY);
  if (!id) {
    id = 'seat-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SEAT_KEY, id);
  }
  return id;
}

const camera = new MapCamera(stage, cameraEl);

let snapshot = null;
let renderedMapId = null;
let naturalSize = null;

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.className = 'seat-status seat-status-' + state;
}

function myTokenId() {
  return snapshot?.private?.tokenId ?? null;
}

function myToken() {
  const id = myTokenId();
  const tokens = snapshot?.shared?.map?.tokens || [];
  return id ? tokens.find((t) => t.id === id) || null : null;
}

function applySnapshot(next) {
  snapshot = next;
  const map = next?.shared?.map || null;

  titleEl.textContent = map?.name || 'Cove';
  document.title = (map?.name ? map.name + ' - ' : '') + 'Cove Player Seat';

  if (!map || !map.imageDataUrl) {
    cameraEl.innerHTML = '';
    cameraEl.style.transform = '';
    emptyEl.hidden = false;
    emptyEl.textContent = map ? 'The DM has not loaded an image for this map yet.' : 'Waiting for the DM to open a map…';
    renderedMapId = null;
    naturalSize = null;
    renderPanel();
    return;
  }
  emptyEl.hidden = true;

  const refit = map.id !== renderedMapId;
  renderMap(map, refit);
  renderedMapId = map.id;

  renderPanel();
  if (!claimOverlay.hidden) renderClaimList(); // keep an open picker fresh
}

function renderMap(map, refit) {
  const aspectRatio = naturalSize ? imageAspectRatio(naturalSize.width, naturalSize.height) : 1;
  const surface = renderMapSurface(map, {
    forPlayers: true, // already stripped server-side; explicit for intent
    aspectRatio,
    highlightedTokenId: snapshot?.shared?.highlightedTokenId ?? null,
  });

  cameraEl.innerHTML = '';
  cameraEl.appendChild(surface);
  markOwnToken(surface);

  const img = surface.querySelector('img.map-image');
  if (img) {
    const onSized = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const first = !naturalSize;
      naturalSize = { width: img.naturalWidth, height: img.naturalHeight };
      surface.style.width = img.naturalWidth + 'px';
      surface.style.height = img.naturalHeight + 'px';
      camera.setContentSize(img.naturalWidth, img.naturalHeight);
      if (map.grid.enabled) {
        const existing = surface.querySelector('.map-grid-layer');
        if (existing) existing.remove();
        surface.insertBefore(buildGridSvg(map, imageAspectRatio(img.naturalWidth, img.naturalHeight)), img.nextSibling);
      }
      if (refit || first) camera.fit();
      else camera.apply();
    };
    if (img.complete) onSized();
    else img.addEventListener('load', onSized);
  }

  if (naturalSize) {
    surface.style.width = naturalSize.width + 'px';
    surface.style.height = naturalSize.height + 'px';
    camera.setContentSize(naturalSize.width, naturalSize.height);
    if (refit) camera.fit();
    else camera.apply();
  }
}

function canEdit() {
  return !!snapshot?.canEdit;
}

function markOwnToken(surface) {
  const id = myTokenId();
  if (!id) return;
  const el = surface.querySelector(`.map-token[data-token-id="${cssEscape(id)}"]`);
  if (!el) return;
  el.classList.add('map-token-yours');
  if (canEdit()) {
    el.classList.add('map-token-editable');
    wireTokenDrag(el, surface);
  }
}

/**
 * Lets a player drag their own token (when the DM has enabled player control).
 * Pointer events cover mouse and touch. The move is optimistic locally; the
 * committed position is sent as an intent on release and the host's next
 * snapshot is authoritative. stopPropagation keeps the drag from also panning
 * the camera (which listens on the stage).
 */
function wireTokenDrag(el, surface) {
  let dragging = false;
  const toPercent = (e) => {
    const rect = surface.getBoundingClientRect(); // already reflects the camera scale
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = toPercent(e);
    el.style.left = p.x + '%';
    el.style.top = p.y + '%';
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    const p = toPercent(e);
    sendIntent({ action: 'move', x: p.x, y: p.y });
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { dragging = false; });
}

function sendIntent(intent) {
  transport.intent(intent);
}

function renderPanel() {
  const token = myToken();
  if (!token) { panelEl.hidden = true; panelEl.innerHTML = ''; return; }
  panelEl.hidden = false;
  panelEl.innerHTML = '';

  const swatch = document.createElement('span');
  swatch.className = 'seat-panel-swatch';
  swatch.style.background = token.color;

  const name = document.createElement('span');
  name.className = 'seat-panel-name';
  name.textContent = token.name;

  panelEl.append(swatch, name);

  // HP: a live readout, and - when the DM allows player control and the token
  // tracks HP - inline -/+ controls that send an intent to change it.
  if (token.hp != null) {
    if (canEdit()) {
      const hpWrap = document.createElement('span');
      hpWrap.className = 'seat-panel-hp';
      const minus = document.createElement('button');
      minus.className = 'seat-hp-btn';
      minus.textContent = '−';
      minus.title = 'Take 1 damage';
      minus.addEventListener('click', () => sendIntent({ action: 'hp', hp: token.hp - 1 }));
      const label = document.createElement('span');
      label.className = 'seat-panel-stats';
      label.textContent = `HP ${token.hp}${token.maxHp != null ? '/' + token.maxHp : ''}`;
      const plus = document.createElement('button');
      plus.className = 'seat-hp-btn';
      plus.textContent = '+';
      plus.title = 'Heal 1';
      plus.addEventListener('click', () => sendIntent({ action: 'hp', hp: token.hp + 1 }));
      hpWrap.append(minus, label, plus);
      panelEl.appendChild(hpWrap);
    } else {
      const stats = document.createElement('span');
      stats.className = 'seat-panel-stats';
      stats.textContent = `HP ${token.hp}${token.maxHp != null ? '/' + token.maxHp : ''}`;
      panelEl.appendChild(stats);
    }
  }
  if (token.ac != null) {
    const ac = document.createElement('span');
    ac.className = 'seat-panel-stats';
    ac.textContent = `AC ${token.ac}`;
    panelEl.appendChild(ac);
  }

  const findBtn = document.createElement('button');
  findBtn.className = 'map-popout-ctrl-btn';
  findBtn.textContent = 'Center on me';
  findBtn.addEventListener('click', () => centerOnToken(token));
  panelEl.appendChild(findBtn);
}

function centerOnToken(token) {
  if (!naturalSize) return;
  const rect = stage.getBoundingClientRect();
  const scale = camera.scale;
  // token.x/token.y are percents of the image; convert to content pixels.
  const cx = (token.x / 100) * naturalSize.width * scale;
  const cy = (token.y / 100) * naturalSize.height * scale;
  camera._offset = { x: rect.width / 2 - cx, y: rect.height / 2 - cy };
  camera.apply();
}

// ---- claim ("which token is yours") ----

function openClaim() {
  renderClaimList();
  claimOverlay.hidden = false;
}
function closeClaim() {
  claimOverlay.hidden = true;
}

function renderClaimList() {
  const tokens = snapshot?.shared?.map?.tokens || [];
  claimList.innerHTML = '';
  if (tokens.length === 0) {
    const p = document.createElement('p');
    p.className = 'seat-claim-empty';
    p.textContent = 'No tokens on the map yet. Ask the DM to place your character.';
    claimList.appendChild(p);
    return;
  }
  const mine = myTokenId();
  for (const token of tokens) {
    const btn = document.createElement('button');
    btn.className = 'seat-claim-choice' + (token.id === mine ? ' active' : '');
    const sw = document.createElement('span');
    sw.className = 'seat-panel-swatch';
    sw.style.background = token.color;
    const label = document.createElement('span');
    label.textContent = token.name;
    btn.append(sw, label);
    btn.addEventListener('click', () => { claim(token.id); closeClaim(); });
    claimList.appendChild(btn);
  }
}

function claim(tokenId) {
  transport.claim(tokenId);
  // The host pushes a fresh snapshot with the new private layer back to us.
}

function release() {
  transport.release();
}

/** Minimal CSS.escape fallback for older mobile browsers. */
function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

// ---- wiring ----

document.getElementById('fitBtn').addEventListener('click', () => camera.fit());
document.getElementById('claimBtn').addEventListener('click', openClaim);
document.getElementById('claimClose').addEventListener('click', closeClaim);
document.getElementById('claimSpectate').addEventListener('click', () => { release(); closeClaim(); });

// ---- transport ----
// One seat page, two ways in: served by the DM's LAN server it talks SSE to
// this same origin; served by the relay (path /r/<code>) it talks WebSocket to
// the relay, which bridges to the DM. The rendering above doesn't care which.

function makeTransport() {
  return location.pathname.startsWith('/r/') ? relayTransport() : sseTransport();
}

function sseTransport() {
  return {
    connect({ onSnapshot, onStatus, onJoinStatus }) {
      const source = new EventSource('/events?seat=' + encodeURIComponent(seatId()));
      source.addEventListener('open', () => onStatus('Connected', 'connected'));
      source.addEventListener('snapshot', (e) => {
        onStatus('Connected', 'connected');
        try { onSnapshot(JSON.parse(e.data)); } catch { /* ignore a malformed frame */ }
      });
      source.addEventListener('status', (e) => {
        try { onJoinStatus(JSON.parse(e.data).status); } catch { /* ignore */ }
      });
      source.addEventListener('error', () => onStatus('Reconnecting…', 'connecting'));
    },
    claim(tokenId) { postJson('/claim', { seat: seatId(), tokenId }); },
    release() { postJson('/release', { seat: seatId() }); },
    intent(intent) { postJson('/intent', { seat: seatId(), intent }); },
  };
}

function relayTransport() {
  const room = decodeURIComponent(location.pathname.replace(/^\/r\//, '').replace(/\/$/, ''));
  const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
  let ws = null;
  let handlers = null;

  const open = () => {
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      handlers.onStatus('Connected', 'connected');
      ws.send(JSON.stringify({ t: 'join', room, seat: seatId() }));
    });
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'snapshot') { handlers.onStatus('Connected', 'connected'); handlers.onSnapshot(m.snapshot); }
      else if (m.t === 'status') handlers.onJoinStatus(m.status);
      else if (m.t === 'kicked') handlers.onJoinStatus('kicked');
      else if (m.t === 'no-room') handlers.onStatus('Room not found - ask the DM for the current link.', 'error');
      else if (m.t === 'host-gone') handlers.onStatus('The DM has closed the table.', 'error');
    });
    ws.addEventListener('close', () => {
      handlers.onStatus('Reconnecting…', 'connecting');
      setTimeout(open, 3000); // the DM may reopen the same room; keep trying
    });
    ws.addEventListener('error', () => { /* close handler drives reconnection */ });
  };

  return {
    connect(h) { handlers = h; open(); },
    claim(tokenId) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'claim', tokenId })); },
    release() { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'release' })); },
    intent(intent) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'intent', intent })); },
  };
}

function postJson(url, body) {
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .catch(() => { /* the stream re-syncs on reconnect */ });
}

/** Reflects where a join stands when the DM requires approval. */
function handleJoinStatus(status) {
  if (status === 'active') return; // the next snapshot will render the map
  const notice = {
    pending: 'Waiting for the DM to let you in…',
    denied: 'The DM declined your request to join.',
    kicked: 'The DM removed you from the session.',
  }[status];
  if (!notice) return;
  cameraEl.innerHTML = '';
  cameraEl.style.transform = '';
  emptyEl.hidden = false;
  emptyEl.textContent = notice;
  setStatus(status === 'pending' ? 'Waiting' : 'Not admitted', status === 'pending' ? 'connecting' : 'error');
}

const transport = makeTransport();
transport.connect({ onSnapshot: applySnapshot, onStatus: setStatus, onJoinStatus: handleJoinStatus });
