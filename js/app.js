"use strict";
// ═════════════ Upiorna Noc Gier — rdzeń: pokoje (serwer pokoi, js/net.js), lobby, rejestr gier ═════════════
// Host trzyma cały stan pokoju i gry, goście wysyłają tylko akcje i dostają gotowy widok.

const PREFIX = "upiornanoc-gmal-";
const MAX_PLAYERS = 10;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const HOST_SAVE_MAX_AGE = 12 * 3600e3;
const mkPeer = id => (id ? new Peer(id) : new Peer());

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mkStore = area => ({
  get(k, d) { try { const v = area.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { area.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { area.removeItem(k); } catch {} },
});
const ls = mkStore(localStorage);
const ss = mkStore(sessionStorage);

// Identyfikator gracza – per karta przeglądarki (przeżywa odświeżenie), żeby dało się wrócić do pokoju.
const CID = ss.get("hg-cid") || (() => { const id = "p" + Math.random().toString(36).slice(2, 10); ss.set("hg-cid", id); return id; })();

// ═════════════ Rejestr gier ═════════════
// Gra = { id, name, emoji, tagline, min, max, create(room, prev), action(st, pid, msg, room) → błąd|undefined,
//         view(st, pid, room), render(view), playerLeft?(st, pid, room), photoMap?(view), effects?(prev, view), hostMenu?(view) }
const GAMES = [];
function registerGame(g) { GAMES.push(g); }
const gameById = id => GAMES.find(g => g.id === id);

// ═════════════ Stan klienta ═════════════
const S = {
  screen: "home", name: ls.get("hg-name", ""), joinCode: "", mode: null,
  peer: null, hostConn: null, conns: new Map(), code: null, view: null,
  photos: {}, myPhoto: ls.get("hg-photo", null), lost: false, menu: false,
  lastSeen: 0, retryTimer: null, retries: 0,
};
let R = null; // stan pokoju – tylko u hosta

let ME = CID;
const isHost = () => S.mode === "host";
const me = () => ME;
const players = () => (S.view ? S.view.players : []);
const player = id => players().find(p => p.id === id);
const pName = id => (player(id) || {}).name || "Ktoś";
const hueOf = id => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function avatar(id, cls = "") {
  const p = player(id);
  const has = !!S.photos[id];
  return `<span class="av av-${esc(id)} ${has ? "has" : ""} ${cls}" style="--h:${hueOf(id)}">${has ? "" : esc(((p && p.name) || "?").slice(0, 1).toUpperCase())}</span>`;
}

// ═════════════ Render ═════════════
function render() {
  const app = $("#app");
  const tpl = document.createElement("template");
  tpl.innerHTML = screenHTML();
  morph(app, tpl.content);
  document.body.dataset.screen = S.screen === "room" && S.view ? (S.view.phase === "game" ? "game-" + S.view.gameId : "lobby") : S.screen;
  updatePhotoCSS();
}

// Łatanie DOM zamiast podmiany – animacje, przewijanie i otwarte listy przeżywają aktualizacje stanu.
function morph(from, to) {
  const a = from.childNodes, b = to.childNodes;
  for (let i = 0; i < b.length; i++) {
    const nb = b[i], oa = a[i];
    if (!oa) { from.appendChild(nb.cloneNode(true)); continue; }
    if (oa.nodeType !== nb.nodeType || oa.nodeName !== nb.nodeName || (oa.nodeType === 1 && oa.getAttribute("data-key") !== nb.getAttribute("data-key"))) {
      from.replaceChild(nb.cloneNode(true), oa); continue;
    }
    if (oa.nodeType !== 1) { if (oa.nodeValue !== nb.nodeValue) oa.nodeValue = nb.nodeValue; continue; }
    for (const at of [...oa.attributes]) if (!nb.hasAttribute(at.name) && !(at.name === "open" && oa.tagName === "DETAILS")) oa.removeAttribute(at.name);
    for (const at of nb.attributes) if (oa.getAttribute(at.name) !== at.value) oa.setAttribute(at.name, at.value);
    morph(oa, nb);
    if (oa.tagName === "INPUT" && oa.type !== "file" && document.activeElement !== oa) oa.value = nb.getAttribute("value") || "";
    if (oa.tagName === "SELECT") { const o = nb.querySelector("option[selected]"); oa.value = o ? o.getAttribute("value") : ""; }
  }
  while (a.length > b.length) from.removeChild(from.lastChild);
}

function screenHTML() {
  if (S.screen === "connecting") return connectingHTML();
  if (S.screen === "room" && S.view) return roomHTML();
  return homeHTML();
}

function homeHTML() {
  const saved = hostSave();
  return `
  <section class="home">
    <div class="hero">
      <div class="logo-pumpkin">🎃</div>
      <h1 class="spooky">Upiorna<br><span>Noc Gier</span></h1>
      <p class="sub">Halloweenowe gry dla ekipy · każdy na swoim telefonie</p>
    </div>
    <div class="glass form">
      <label for="name">Twoje imię</label>
      <input id="name" maxlength="16" autocomplete="nickname" placeholder="np. Kinia" value="${esc(S.name)}">
      <button class="btn orange big" data-do="create">🕯️ Stwórz pokój</button>
      <div class="or"><span>albo dołącz do znajomych</span></div>
      <div class="join-row">
        <input id="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="KOD" value="${esc(S.joinCode)}">
        <button class="btn purple" data-do="join">Dołącz 👻</button>
      </div>
      ${saved ? `<button class="btn ghost" data-do="restore">↺ Wróć do swojego pokoju <b>${esc(saved.code)}</b></button>` : ""}
    </div>
    <div class="graveyard"><span>🪦</span><span class="flick">🎃</span><span>🕸️</span><span class="flick d2">🎃</span><span>🪦</span></div>
  </section>`;
}

function connectingHTML() {
  return `<section class="connecting"><div class="cauldron">🔮</div><p class="spooky">Przywołuję duchy…</p><p class="hint">Łączenie z pokojem</p>
    <button class="btn ghost small" data-do="home">Anuluj</button></section>`;
}

function roomHTML() {
  const v = S.view;
  const g = v.phase === "game" ? gameById(v.gameId) : null;
  const body = g ? g.render(v.game) : lobbyHTML();
  const menu = isHost() && g && S.menu ? hostMenuHTML(g) : "";
  return `
  <header class="topbar">
    <button class="icon-btn" data-do="leave" aria-label="Wyjdź">✕</button>
    <div class="room-chip"><small>pokój</small><b>${esc(v.code)}</b></div>
    <div class="top-title">${g ? `${g.emoji} ${esc(g.name)}` : "🦇 Lobby"}</div>
    ${isHost() && g ? `<button class="icon-btn" data-do="menu" aria-label="Menu hosta">⚙️</button>` : `<span class="online-count">👻 ${players().filter(p => p.online).length}</span>`}
  </header>
  ${menu}
  <div class="room-body">${body}</div>
  ${S.lost ? `<div class="lost"><div class="glass"><div class="cauldron small">🕯️</div><p><b>Łączę ponownie…</b></p><p class="hint">Telefon zasnął albo host zniknął na chwilę.</p><button class="btn ghost small" data-do="home">Wyjdź z pokoju</button></div></div>` : ""}`;
}

function hostMenuHTML(g) {
  const items = (g.hostMenu ? g.hostMenu(S.view.game) : []).concat([{ label: "🏚️ Wróć do lobby (wybór gry)", act: "room.lobby" }]);
  return `<div class="menu-veil" data-do="menu"></div><nav class="host-menu glass">
    ${items.map(i => `<button class="btn ghost" data-act="${esc(i.act)}" data-x="${esc(i.x ?? "")}" data-close="1">${i.label}</button>`).join("")}
  </nav>`;
}

function lobbyHTML() {
  const v = S.view;
  const list = players();
  return `
  <section class="lobby">
    <div class="glass code-card">
      <small>Kod pokoju – podaj znajomym</small>
      <div class="code-big">${[...v.code].map((c, i) => `<span style="--i:${i}">${esc(c)}</span>`).join("")}</div>
      <button class="btn ghost small" data-do="share">🔗 Udostępnij link</button>
    </div>
    <div class="glass">
      <h3>Ekipa <span class="count">${list.length}</span></h3>
      <ul class="plist">
        ${list.map(p => `<li class="${p.online ? "" : "off"}">${avatar(p.id)}<span class="pn">${esc(p.name)}${p.id === me() ? ' <em>(Ty)</em>' : ""}</span>
          ${p.id === v.hostId ? '<span class="tag">👑 host</span>' : ""}${p.online ? "" : '<span class="tag dim">offline</span>'}
          ${isHost() && p.id !== me() ? `<button class="kick" data-act="room.kick" data-x="${esc(p.id)}" aria-label="Wyrzuć">✕</button>` : ""}</li>`).join("")}
      </ul>
    </div>
    <div class="glass">
      <h3>${isHost() ? "Wybierz grę" : "Gry na dziś"}</h3>
      <div class="games">
        ${GAMES.map(g => `<div class="game-tile">
          <div class="gt-emoji">${g.emoji}</div>
          <div class="gt-info"><b>${esc(g.name)}</b><p>${esc(g.tagline)}</p><small>${g.min}–${g.max} graczy</small></div>
          ${isHost() ? `<button class="btn orange small" data-act="room.game" data-x="${g.id}">Graj</button>` : ""}
        </div>`).join("")}
        <div class="game-tile soon"><div class="gt-emoji">🕸️</div><div class="gt-info"><b>Kolejne gry…</b><p>Wkrótce wypełzną z grobu</p></div></div>
      </div>
      ${isHost() ? "" : `<p class="hint wait">⏳ Host wybiera grę…</p>`}
    </div>
  </section>`;
}

// Zdjęcia: jeden blok CSS zamiast powtarzania data-URL w każdej karcie.
let photoSig = "";
function updatePhotoCSS() {
  const g = S.view && S.view.phase === "game" ? gameById(S.view.gameId) : null;
  const map = g && g.photoMap ? g.photoMap(S.view.game) : {};
  const sig = Object.keys(S.photos).map(k => k + S.photos[k].length).join() + "|" + JSON.stringify(map);
  if (sig === photoSig) return;
  photoSig = sig;
  let css = "";
  for (const [id, data] of Object.entries(S.photos)) css += `.av-${id}{background-image:url("${data}")}`;
  for (const [cls, id] of Object.entries(map)) if (S.photos[id]) css += `.${cls}{background-image:url("${S.photos[id]}")!important}.${cls}>em{display:none}`;
  $("#photo-css").textContent = css;
}

function toast(msg) {
  if (!msg) return;
  const t = $("#toast");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  t.appendChild(el);
  setTimeout(() => el.classList.add("out"), 2600);
  setTimeout(() => el.remove(), 3100);
}

// ═════════════ Zdarzenia UI ═════════════
const DO = {
  create() { createRoom(); },
  join() { joinRoom(); },
  restore() { const s = hostSave(); if (s) createRoom(s); },
  home() { goHome(); },
  leave() {
    const q = isHost() ? "Zamknąć pokój dla wszystkich?" : "Wyjść z pokoju?";
    if (confirm(q)) goHome();
  },
  menu() { S.menu = !S.menu; render(); },
  share() {
    const url = `${location.origin}${location.pathname}?k=${S.view.code}`;
    if (navigator.share) navigator.share({ title: "Upiorna Noc Gier 🎃", text: `Dołącz do pokoju ${S.view.code}!`, url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => toast("Skopiowano link 🔗"), () => toast(url));
  },
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-do],[data-act]");
  if (!el || el.disabled) return;
  if (el.dataset.close) S.menu = false;
  if (el.dataset.do) DO[el.dataset.do] && DO[el.dataset.do](el);
  else act({ a: el.dataset.act, x: el.dataset.x ?? null, y: el.dataset.y ?? null });
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.matches("input[type=file][data-photo]")) { const f = el.files && el.files[0]; el.value = ""; if (f) onPhotoFile(f); return; }
  if (el.dataset.chg) act({ a: el.dataset.chg, x: el.dataset.x ?? null, y: el.type === "checkbox" ? el.checked : el.value });
});
document.addEventListener("input", e => {
  if (e.target.id === "name") { S.name = e.target.value; }
  if (e.target.id === "code") { S.joinCode = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5); e.target.value = S.joinCode; }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (e.target.id === "code") joinRoom();
  else if (e.target.id === "name") (S.joinCode.length === 5 ? joinRoom : createRoom)();
});

function act(m) {
  if (!m.a) return;
  if (isHost()) hostAct(me(), m);
  else if (S.hostConn && S.hostConn.open) { try { S.hostConn.send({ t: "act", a: m.a, x: m.x, y: m.y }); } catch {} }
  else toast("Brak połączenia z hostem…");
}

// ═════════════ Zdjęcia ═════════════
async function onPhotoFile(file) {
  try {
    const data = await shrinkPhoto(file);
    S.myPhoto = data;
    ls.set("hg-photo", data);
    sendMyPhoto();
    toast("Zdjęcie gotowe 📸");
  } catch (err) {
    console.warn(err);
    toast("Nie udało się wczytać zdjęcia");
  }
}

// Kwadrat 300×300, kadr lekko w górę (twarz), JPEG ~20–30 kB.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 300;
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - s) / 2;
      const sy = Math.max(0, (img.naturalHeight - s) * 0.35);
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
    img.src = url;
  });
}

function sendMyPhoto() {
  if (!S.myPhoto) return;
  if (isHost()) setPhoto(me(), S.myPhoto);
  else if (S.hostConn && S.hostConn.open) { try { S.hostConn.send({ t: "photo", data: S.myPhoto }); } catch {} }
}

// ═════════════ Host ═════════════
const genCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const hostSave = () => { const s = ls.get("hg-host", null); return s && Date.now() - s.ts < HOST_SAVE_MAX_AGE ? s : null; };

function createRoom(restore, attempt = 0) {
  const name = S.name.trim();
  if (!restore && !name) { toast("Wpisz swoje imię 🙂"); return; }
  if (!window.Peer) { toast("Brak połączenia z serwerem gry. Sprawdź internet."); return; }
  if (name) ls.set("hg-name", name);
  if (attempt === 0) { leaveAll(); S.screen = "connecting"; render(); }

  const code = restore ? restore.code : genCode();
  const peer = mkPeer(PREFIX + code);
  S.peer = peer;

  peer.on("open", () => {
    if (S.peer !== peer) return;
    S.mode = "host";
    S.code = code;
    if (restore) {
      R = restore.R;
      S.photos = restore.photos || {};
      R.players.forEach(p => { p.online = p.id === R.hostId; });
      // Ta karta przejmuje tożsamość hosta z zapisu.
      ME = R.hostId;
      ss.set("hg-cid", ME);
    } else {
      R = { code, hostId: ME, phase: "lobby", gameId: null, gs: null, prev: {}, players: [{ id: ME, name, online: true }] };
      S.photos = {};
      if (S.myPhoto) S.photos[ME] = S.myPhoto;
    }
    ss.set("hg-role", { role: "host" });
    S.screen = "room";
    hostChanged();
  });

  peer.on("connection", conn => {
    conn.on("data", msg => onGuestMessage(conn, msg));
    conn.on("close", () => guestGone(conn));
    conn.on("error", () => guestGone(conn));
    conn.on("iceStateChanged", st => { if (st === "failed" || st === "closed") guestGone(conn); });
  });

  peer.on("error", err => {
    if (S.peer !== peer) return;
    if (err.type === "unavailable-id") {
      try { peer.destroy(); } catch {}
      if (!restore) return createRoom(null, attempt + 1);
      // Serwer jeszcze pamięta stary identyfikator – próbujemy ponownie przez ~1 min.
      if (attempt < 15) return setTimeout(() => { if (S.peer === peer) createRoom(restore, attempt + 1); }, 5000);
      toast("Nie udało się odzyskać pokoju."); goHome(); return;
    }
    console.warn(err);
    if (S.mode !== "host") { toast("Nie udało się utworzyć pokoju. Spróbuj ponownie."); goHome(); }
  });

  peer.on("disconnected", () => { setTimeout(() => { if (S.peer === peer && !peer.destroyed && peer.disconnected) try { peer.reconnect(); } catch {} }, 1000); });
}

function onGuestMessage(conn, msg) {
  if (!msg || typeof msg !== "object" || !R) return;
  const pid = conn._pid;
  if (msg.t === "hb") { try { conn.send({ t: "hb" }); } catch {} if (pid) markOnline(pid, conn); return; }
  if (msg.t === "join") return guestJoin(conn, msg);
  if (!pid || S.conns.get(pid) !== conn) return;
  if (msg.t === "act") hostAct(pid, { a: String(msg.a || ""), x: msg.x, y: msg.y });
  else if (msg.t === "photo") setPhoto(pid, msg.data);
  else if (msg.t === "leave") removePlayer(pid);
}

function guestJoin(conn, msg) {
  const cid = String(msg.cid || "").replace(/[^a-z0-9]/gi, "").slice(0, 16) || conn.peer.replace(/[^a-z0-9]/gi, "").slice(0, 16);
  const name = String(msg.name || "").trim().slice(0, 16) || "Gość";
  let p = R.players.find(x => x.id === cid);
  // Telefon zgubił sesję – wracamy do gracza offline o tym samym imieniu.
  if (!p) p = R.players.find(x => !x.online && x.id !== R.hostId && x.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    if (R.players.length >= MAX_PLAYERS) { try { conn.send({ t: "reject", reason: "Pokój jest pełny." }); } catch {} setTimeout(() => conn.close(), 300); return; }
    p = { id: cid, name, online: true };
    R.players.push(p);
  }
  p.name = name;
  const old = S.conns.get(p.id);
  if (old && old !== conn) { old._pid = null; try { old.close(); } catch {} }
  conn._pid = p.id;
  S.conns.set(p.id, conn);
  p.online = true;
  try {
    conn.send({ t: "welcome", id: p.id });
    for (const [id, data] of Object.entries(S.photos)) conn.send({ t: "photo", id, data });
  } catch {}
  hostChanged();
}

function markOnline(pid, conn) {
  const p = R.players.find(x => x.id === pid);
  if (p && !p.online && S.conns.get(pid) === conn) { p.online = true; hostChanged(); }
}

function guestGone(conn) {
  const pid = conn._pid;
  if (!pid || !R || S.conns.get(pid) !== conn) return;
  S.conns.delete(pid);
  const p = R.players.find(x => x.id === pid);
  if (p) p.online = false;
  hostChanged();
}

function removePlayer(pid) {
  if (!R || pid === R.hostId) return;
  const c = S.conns.get(pid);
  S.conns.delete(pid);
  if (c) { c._pid = null; setTimeout(() => { try { c.close(); } catch {} }, 300); }
  R.players = R.players.filter(p => p.id !== pid);
  delete S.photos[pid];
  const g = R.phase === "game" && gameById(R.gameId);
  if (g && g.playerLeft) g.playerLeft(R.gs, pid, R);
  hostChanged();
}

function setPhoto(pid, data) {
  if (typeof data !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(data) || data.length > 250000) return;
  S.photos[pid] = data;
  for (const [id, c] of S.conns) if (id !== pid && c.open) { try { c.send({ t: "photo", id: pid, data }); } catch {} }
  if (pid !== me()) { const c = S.conns.get(pid); if (c && c.open) try { c.send({ t: "photo", id: pid, data }); } catch {} }
  hostChanged();
}

function hostAct(pid, m) {
  if (!R) return;
  let err;
  if (m.a.startsWith("room.")) {
    if (pid !== R.hostId) return;
    if (m.a === "room.game") {
      const g = gameById(String(m.x));
      if (!g) return;
      R.gameId = g.id;
      R.phase = "game";
      R.gs = g.create(R, R.prev[g.id]);
    } else if (m.a === "room.lobby") {
      if (R.gameId && R.gs) R.prev[R.gameId] = R.gs;
      R.phase = "lobby"; R.gs = null; R.gameId = null;
    } else if (m.a === "room.kick") {
      const p = R.players.find(x => x.id === m.x);
      if (!p || !confirm(`Wyrzucić ${p.name} z pokoju?`)) return;
      const c = S.conns.get(p.id);
      if (c) try { c.send({ t: "kicked" }); } catch {}
      return removePlayer(p.id);
    }
  } else if (R.phase === "game") {
    err = gameById(R.gameId).action(R.gs, pid, m, R);
  }
  if (err) {
    if (pid === me()) toast(err);
    else { const c = S.conns.get(pid); if (c) try { c.send({ t: "toast", msg: err }); } catch {} }
  }
  hostChanged();
}

function viewFor(pid) {
  const g = R.phase === "game" ? gameById(R.gameId) : null;
  return {
    code: R.code, phase: R.phase, gameId: R.gameId, hostId: R.hostId,
    players: R.players.map(p => ({ id: p.id, name: p.name, online: p.online })),
    game: g ? g.view(R.gs, pid, R) : null,
  };
}

let saveTimer = null;
function hostChanged() {
  if (!R) return;
  for (const [pid, c] of S.conns) if (c.open) { try { c.send({ t: "state", view: viewFor(pid) }); } catch {} }
  applyView(viewFor(me()));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (R) ls.set("hg-host", { code: R.code, R, photos: S.photos, ts: Date.now() }); }, 400);
}

// ═════════════ Gość ═════════════
// Jeden obiekt połączenia na całą wizytę – ponowne próby dołączenia używają go dalej.
let attemptSeq = 0;

function guestPeer(cb) {
  let p = S.peer;
  if (p && !p.destroyed && p.open) return cb(p);
  S.peerWaiters = [cb];
  if (p && !p.destroyed) { if (p.disconnected) try { p.reconnect(); } catch {} return; }
  p = mkPeer();
  S.peer = p;
  p.on("open", () => { if (S.peer !== p) return; const w = S.peerWaiters || []; S.peerWaiters = []; w.forEach(f => f(p)); });
  p.on("error", err => { if (S.peer === p && S.onPeerError) S.onPeerError(err); });
  p.on("disconnected", () => { setTimeout(() => { if (S.peer === p && !p.destroyed && p.disconnected) try { p.reconnect(); } catch {} }, 1500); });
}

function joinRoom(opts = {}) {
  const name = (opts.name || S.name).trim();
  const code = (opts.code || S.joinCode).trim().toUpperCase();
  if (!name) { toast("Wpisz swoje imię 🙂"); return; }
  if (code.length !== 5) { toast("Kod pokoju ma 5 znaków"); return; }
  if (!window.Peer) { toast("Brak połączenia z serwerem gry. Sprawdź internet."); return; }
  S.name = name;
  ls.set("hg-name", name);
  if (!opts.retry) { leaveAll(); S.screen = "connecting"; render(); }

  const my = ++attemptSeq;
  let joined = false, failed = false;

  const fail = text => {
    if (my !== attemptSeq || failed) return;
    failed = true;
    clearTimeout(timeout);
    // Połączenie z serwerem, które się nie otworzyło, nie nadaje się do ponownego użycia.
    if (S.peer && !S.peer.open) { const p = S.peer; S.peer = null; try { p.destroy(); } catch {} }
    if (opts.retry || opts.auto) return scheduleRetry(code, name);
    toast(text);
    leaveAll();
    S.screen = "home";
    render();
  };
  const timeout = setTimeout(() => { if (!joined) fail("Nie udało się połączyć z pokojem."); }, 12000);

  S.onPeerError = err => {
    if (my !== attemptSeq) return;
    if (err.type === "peer-unavailable") fail(`Nie ma pokoju o kodzie ${code} 🕸️`);
    else if (!joined) fail("Błąd połączenia. Spróbuj ponownie.");
    else console.warn(err);
  };

  guestPeer(peer => {
    if (my !== attemptSeq) return;
    const conn = peer.connect(PREFIX + code, { reliable: true });
    const old = S.hostConn;
    S.hostConn = conn;
    if (old) try { old.close(); } catch {}
    conn.on("open", () => conn.send({ t: "join", name, cid: ME }));
    conn.on("data", msg => {
      if (!msg || typeof msg !== "object" || S.hostConn !== conn) return;
      S.lastSeen = Date.now();
      if (msg.t === "welcome") {
        if (msg.id && msg.id !== ME) { ME = msg.id; ss.set("hg-cid", ME); }
      } else if (msg.t === "state") {
        if (!joined) {
          joined = true;
          clearTimeout(timeout);
          S.mode = "guest"; S.code = code; S.screen = "room"; S.lost = false; S.retries = 0;
          ss.set("hg-role", { role: "guest", code, name });
          if (S.myPhoto && !S.photos[ME]) sendMyPhoto();
        }
        applyView(msg.view);
      } else if (msg.t === "photo") {
        S.photos[msg.id] = msg.data;
        render();
      } else if (msg.t === "reject") {
        opts.retry = opts.auto = false;
        fail(msg.reason || "Nie można dołączyć.");
      } else if (msg.t === "toast") {
        toast(String(msg.msg || ""));
      } else if (msg.t === "kicked") {
        ss.del("hg-role"); toast("Host usunął Cię z pokoju."); goHome();
      } else if (msg.t === "closed") {
        ss.del("hg-role"); toast("Host zamknął pokój 🕯️"); goHome();
      }
    });
    const lost = () => { if (S.hostConn === conn && S.mode === "guest" && joined) connectionLost(); else if (!joined) fail("Nie udało się połączyć z pokojem."); };
    conn.on("close", lost);
    conn.on("iceStateChanged", st => { if (st === "failed" || st === "closed") lost(); });
  });
}

function connectionLost() {
  if (S.lost) return;
  S.lost = true;
  render();
  scheduleRetry(S.code, S.name.trim() || ls.get("hg-name", ""), 800);
}

// Coraz dłuższe przerwy między próbami (do ~25 s), z odrobiną losowości, żeby telefony nie łączyły się naraz.
function scheduleRetry(code, name, delay) {
  clearTimeout(S.retryTimer);
  if (++S.retries > 40) { toast("Nie udało się wrócić do pokoju."); ss.del("hg-role"); goHome(); return; }
  S.lost = true;
  S.mode = S.mode || "guest";
  render();
  const wait = delay ?? Math.min(25000, 1500 * 1.5 ** (S.retries - 1)) * (0.8 + Math.random() * 0.4);
  S.retryTimer = setTimeout(() => joinRoom({ code, name, retry: true }), wait);
}

// Puls co 5 s – jeśli host milczy > 20 s, łączymy się od nowa.
setInterval(() => {
  if (S.mode !== "guest" || S.lost || !S.hostConn) return;
  if (S.hostConn.open) try { S.hostConn.send({ t: "hb" }); } catch {}
  if (document.visibilityState === "visible" && S.lastSeen && Date.now() - S.lastSeen > 20000) { try { S.hostConn.close(); } catch {} connectionLost(); }
}, 5000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (S.mode === "guest" && !S.lost && (!S.hostConn || !S.hostConn.open)) connectionLost();
  if (S.peer && S.peer.disconnected && !S.peer.destroyed) try { S.peer.reconnect(); } catch {}
  if (S.mode === "guest") S.lastSeen = Date.now();
});

// ═════════════ Wspólne ═════════════
function applyView(view) {
  const prev = S.view;
  S.view = view;
  const g = view.phase === "game" ? gameById(view.gameId) : null;
  if (!g) S.menu = false;
  render();
  if (g && g.effects) g.effects(prev && prev.gameId === view.gameId ? prev.game : null, view.game);
}

function leaveAll() {
  clearTimeout(S.retryTimer);
  attemptSeq++;
  S.onPeerError = null;
  S.peerWaiters = [];
  if (S.mode === "host") for (const c of S.conns.values()) { try { c.send({ t: "closed" }); } catch {} }
  if (S.mode === "guest" && S.hostConn) { try { S.hostConn.send({ t: "leave" }); } catch {} }
  const peer = S.peer;
  if (peer) setTimeout(() => { try { peer.destroy(); } catch {} }, 250);
  R = null;
  Object.assign(S, { mode: null, peer: null, hostConn: null, conns: new Map(), code: null, view: null, photos: {}, lost: false, menu: false, retries: 0, lastSeen: 0 });
}

function goHome() {
  if (S.mode === "host") ls.del("hg-host");
  ss.del("hg-role");
  leaveAll();
  S.screen = "home";
  history.replaceState(null, "", location.pathname);
  render();
}

function init() {
  const k = new URLSearchParams(location.search).get("k");
  if (k) S.joinCode = k.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  render();
  // Odświeżenie strony w trakcie gry – wracamy automatycznie.
  const role = ss.get("hg-role", null);
  if (!role) return;
  const waitPeer = fn => (window.Peer ? fn() : setTimeout(() => waitPeer(fn), 200));
  if (role.role === "host") { const s = hostSave(); if (s) waitPeer(() => createRoom(s)); }
  else if (role.role === "guest") waitPeer(() => { S.screen = "connecting"; render(); joinRoom({ code: role.code, name: role.name, auto: true }); });
}
document.addEventListener("DOMContentLoaded", init);
