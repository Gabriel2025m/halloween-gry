// ═════════════ Serwer pokoi Upiornej Nocy Gier (Cloudflare Worker + Durable Object) ═════════════
// Jeden Durable Object = jeden pokój (kod 5 znaków). Host i goście łączą się WebSocketem,
// serwer tylko przekazuje wiadomości: gość → host oraz host → wybrany gość. Cały stan gry trzyma host.
//
//   wss://pokoje.g-mal.com.pl/room/ABCDE?role=host&key=…   – host (key pozwala wrócić po odświeżeniu)
//   wss://pokoje.g-mal.com.pl/room/ABCDE?role=guest&id=…   – gość
//
// Ramki serwera do klienta mają pole `sys`, zwykłe wiadomości gry jadą w `data`.

const CODE_RE = /^[A-Z0-9]{5}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_MSG = 400_000;
const MAX_GUESTS = 16;

const ALLOWED_ORIGINS = [
  "https://gry.g-mal.com.pl",
  "https://gabriel2025m.github.io",
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
const originOk = o => !o || ALLOWED_ORIGINS.some(a => (typeof a === "string" ? a === o : a.test(o)));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return new Response("Upiorna Noc Gier – serwer pokoi 🎃", { status: 200 });
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{5})$/);
    if (!m) return new Response("Not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (!originOk(req.headers.get("Origin"))) return new Response("Forbidden", { status: 403 });
    const code = m[1].toUpperCase();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(req);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    // Ping/pong bez budzenia obiektu – utrzymuje połączenia przy życiu tanim kosztem.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"sys":"ping"}', '{"sys":"pong"}'));
  }

  live(tag) { return this.state.getWebSockets(tag).filter(ws => ws.readyState === 1 && !(ws.deserializeAttachment() || {}).replaced); }
  host() { return this.live("host")[0] || null; }
  guests() { return this.live("guest"); }
  guest(id) { return this.live("g:" + id)[0] || null; }

  async fetch(req) {
    const url = new URL(req.url);
    const role = url.searchParams.get("role");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const reject = (code, reason) => {
      this.state.acceptWebSocket(server, ["rejected"]);
      server.send(JSON.stringify({ sys: "error", type: reason }));
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };

    if (role === "host") {
      const key = String(url.searchParams.get("key") || "");
      if (!ID_RE.test(key)) return reject(4000, "bad-request");
      const cur = this.host();
      if (cur) {
        const curKey = cur.deserializeAttachment()?.key;
        if (curKey !== key) return reject(4009, "unavailable-id");
        // Ten sam host wraca (odświeżenie strony) – stare połączenie zamykamy.
        cur.serializeAttachment({ key, replaced: true });
        try { cur.close(4010, "replaced"); } catch {}
      }
      this.state.acceptWebSocket(server, ["host"]);
      server.serializeAttachment({ key });
      server.send(JSON.stringify({ sys: "open" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (role === "guest") {
      const id = String(url.searchParams.get("id") || "");
      if (!ID_RE.test(id)) return reject(4000, "bad-request");
      const host = this.host();
      if (!host) return reject(4004, "peer-unavailable");
      const old = this.guest(id);
      if (old) { old.serializeAttachment({ id, replaced: true }); try { old.close(4010, "replaced"); } catch {} }
      else if (this.guests().length >= MAX_GUESTS) return reject(4029, "room-full");
      this.state.acceptWebSocket(server, ["guest", "g:" + id]);
      server.serializeAttachment({ id });
      server.send(JSON.stringify({ sys: "open" }));
      host.send(JSON.stringify({ sys: "join", id }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return reject(4000, "bad-request");
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const tags = this.state.getTags(ws);
    if (tags.includes("host")) {
      // Host → jeden gość ({to, data}) albo wszyscy ({all, data}).
      if (msg.to) { const g = this.guest(String(msg.to)); if (g) try { g.send(JSON.stringify({ data: msg.data })); } catch {} }
      else if (msg.all) for (const g of this.guests()) try { g.send(JSON.stringify({ data: msg.data })); } catch {}
      else if (msg.kick) { const g = this.guest(String(msg.kick)); if (g) try { g.close(4001, "closed"); } catch {} }
    } else if (tags.includes("guest")) {
      const id = ws.deserializeAttachment()?.id;
      const host = this.host();
      if (host && id) try { host.send(JSON.stringify({ sys: "msg", from: id, data: msg.data })); } catch {}
    }
  }

  async webSocketClose(ws, code) {
    // Dokończenie zamknięcia – bez tego przeglądarka czeka w stanie „zamykanie”.
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, "bye"); } catch {}
    this.gone(ws);
  }
  async webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const tags = this.state.getTags(ws);
    const att = ws.deserializeAttachment() || {};
    if (att.replaced || tags.includes("rejected")) return;
    if (tags.includes("host")) {
      if (this.host()) return; // już jest nowe połączenie hosta
      // Host zniknął – goście dostają rozłączenie i sami spróbują wrócić, gdy host się pojawi.
      for (const g of this.guests()) try { g.close(4002, "host-left"); } catch {}
    } else if (tags.includes("guest") && att.id) {
      if (this.guest(att.id)) return; // gość zdążył połączyć się ponownie
      const host = this.host();
      if (host) try { host.send(JSON.stringify({ sys: "leave", id: att.id })); } catch {}
    }
  }
}
