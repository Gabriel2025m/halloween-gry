"use strict";
// ═════════════ Połączenia przez nasz serwer pokoi (Cloudflare) ═════════════
// Lekki zamiennik PeerJS z tym samym kształtem API (on/open/connection/connect/send/close),
// ale zamiast WebRTC i publicznego serwera PeerJS wszystko idzie WebSocketem przez pokoje.g-mal.com.pl.
// Do testów lokalnych: ?relay=ws://localhost:8787
// Pokoje są rozdzielone per gra: przedrostek identyfikatora (np. "upiornanoc-gmal-") wyznacza przestrzeń pokoi.

const RELAY_URL = (() => {
  const q = new URLSearchParams(location.search).get("relay");
  return q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? q : "wss://pokoje.g-mal.com.pl";
})();
const PING = '{"sys":"ping"}';

class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); return this; }
  emit(ev, ...args) { for (const fn of (this._h[ev] || []).slice()) { try { fn(...args); } catch (err) { console.error(err); } } }
}

const randomId = () => Math.random().toString(36).slice(2, 12);
const roomPath = full => {
  const s = String(full);
  const ns = s.slice(0, -5).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  return (ns ? ns + "/" : "") + s.slice(-5).toUpperCase();
};

// U hosta: wirtualne połączenie z jednym gościem.
class HostSideConn extends Emitter {
  constructor(peer, id) { super(); this._p = peer; this.peer = id; this.open = true; }
  send(data) { if (this.open) this._p._send({ to: this.peer, data }); }
  close() { if (!this.open) return; this._p._send({ kick: this.peer }); this._drop(); }
  _drop() { if (!this.open) return; this.open = false; this._p._conns.delete(this.peer); this.emit("close"); }
}

// U gościa: własny WebSocket do pokoju.
class GuestConn extends Emitter {
  constructor(peer, target) {
    super();
    this._p = peer;
    this.peer = String(target);
    this.open = false;
    const ws = this._ws = new WebSocket(`${RELAY_URL}/room/${roomPath(target)}?role=guest&id=${encodeURIComponent(peer.id)}`);
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.sys === "open") { this.open = true; this.emit("open"); }
      else if (m.sys === "error") peer.emit("error", { type: m.type, message: m.type });
      else if ("data" in m) this.emit("data", m.data);
    };
    ws.onclose = () => { clearInterval(this._ping); this.open = false; peer._guestConns.delete(this); this.emit("close"); };
    this._ping = setInterval(() => { if (ws.readyState === 1) ws.send(PING); }, 25000);
    peer._guestConns.add(this);
  }
  send(data) { if (this._ws.readyState === 1) this._ws.send(JSON.stringify({ data })); }
  close() { try { this._ws.close(); } catch {} }
}

class RelayPeer extends Emitter {
  // Z identyfikatorem = host pokoju (ostatnie 5 znaków to kod), bez = gość.
  constructor(id) {
    super();
    this.destroyed = false;
    this.disconnected = false;
    this.open = false;
    this._conns = new Map();
    this._guestConns = new Set();
    this._tries = 0;
    if (id) {
      this.id = id;
      this._code = id.slice(-5).toUpperCase();
      this._path = roomPath(id);
      this._key = RelayPeer.hostKey(this._path);
      this._connectHost();
    } else {
      this.id = "g" + randomId();
      setTimeout(() => { if (!this.destroyed) { this.open = true; this.emit("open", this.id); } }, 0);
    }
  }

  // Klucz hosta pozwala tej przeglądarce odzyskać pokój po odświeżeniu.
  static hostKey(path) {
    const k = "relay-hostkey-" + path;
    let v = null;
    try { v = localStorage.getItem(k); } catch {}
    if (!v) { v = randomId() + randomId(); try { localStorage.setItem(k, v); } catch {} }
    return v;
  }

  _connectHost() {
    const ws = this._ws = new WebSocket(`${RELAY_URL}/room/${this._path}?role=host&key=${this._key}`);
    let rejected = false;
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.sys === "open") {
        this._tries = 0;
        this.disconnected = false;
        // „open” tylko za pierwszym razem – po ponownym połączeniu pokój trwa dalej.
        if (!this.open) { this.open = true; this.emit("open", this.id); }
      } else if (m.sys === "error") {
        rejected = true;
        this.emit("error", { type: m.type, message: m.type });
      } else if (m.sys === "join") {
        const old = this._conns.get(m.id);
        if (old) old._drop();
        const c = new HostSideConn(this, m.id);
        this._conns.set(m.id, c);
        this.emit("connection", c);
        c.emit("open");
      } else if (m.sys === "msg") {
        const c = this._conns.get(m.from);
        if (c) c.emit("data", m.data);
      } else if (m.sys === "roster") {
        // Po powrocie hosta: goście, których już nie ma, są rozłączani.
        const ids = new Set(m.ids || []);
        for (const c of [...this._conns.values()]) if (!ids.has(c.peer)) c._drop();
      } else if (m.sys === "leave") {
        const c = this._conns.get(m.id);
        if (c) c._drop();
      }
    };
    ws.onclose = () => {
      clearInterval(this._ping);
      if (this._ws !== ws || this.destroyed || rejected) return;
      // Połączenia z gośćmi zostają – serwer czeka 30 s na powrót hosta, a potem przyśle listę obecnych.
      this.disconnected = true;
      this.emit("disconnected");
    };
    clearInterval(this._ping);
    this._ping = setInterval(() => { if (ws.readyState === 1) ws.send(PING); }, 25000);
  }

  _send(obj) { if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj)); }

  connect(target) { return new GuestConn(this, target); }

  reconnect() {
    if (this.destroyed || !this._code || !this.disconnected || this._reconnecting) return;
    this._reconnecting = true;
    const wait = Math.min(20000, 1000 * 1.6 ** this._tries++);
    setTimeout(() => { this._reconnecting = false; if (!this.destroyed && this.disconnected) this._connectHost(); }, wait);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    clearInterval(this._ping);
    if (this._ws) try { this._ws.close(); } catch {}
    for (const c of [...this._guestConns]) c.close();
    this._conns.clear();
  }
}

window.Peer = RelayPeer;
