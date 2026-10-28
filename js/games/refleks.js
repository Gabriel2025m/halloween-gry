"use strict";
// ═════════════ Dyniowy Refleks ═════════════
// Ekran ciemnieje, po losowej chwili pojawia się dynia – kto dotknie najszybciej, zgarnia punkty.
// Czasem wyskakuje duch: jego dotykać nie wolno. Za dotknięcie przed czasem jest kara.
// Czas reakcji liczy każdy telefon u siebie (od chwili pokazania dyni), więc opóźnienia sieci nie mają znaczenia.
(() => {
  const ROUNDS = [5, 10, 15];
  const POINTS = [3, 2, 1];
  const MIN_HUMAN_MS = 100; // szybciej się nie da – traktujemy jak falstart
  const nameIn = (room, pid) => (room.players.find(p => p.id === pid) || {}).name || "Ktoś";
  const later = (fn, ms) => setTimeout(() => { fn(); if (typeof hostChanged === "function") hostChanged(); }, ms);

  // ─────────── Silnik (u hosta) ───────────
  function create(room, prev) {
    return { phase: "setup", opts: prev ? prev.opts : { rounds: 10 }, round: 0, seats: [], scores: {}, taps: {}, kind: "pumpkin", delay: 0, armN: 0, seq: 1, last: null, plays: prev ? prev.plays || 0 : 0 };
  }

  function start(st, room) {
    const seats = room.players.filter(p => p.online).map(p => p.id);
    if (seats.length < 2) return "Potrzeba co najmniej 2 graczy.";
    Object.assign(st, { seats, scores: {}, round: 0, last: null, plays: st.plays + 1 });
    for (const p of seats) st.scores[p] = 0;
    nextRound(st, room);
  }

  function nextRound(st, room) {
    if (st.round >= st.opts.rounds) { st.phase = "over"; return; }
    st.round++;
    st.kind = st.round > 1 && Math.random() < 0.25 ? "ghost" : "pumpkin";
    st.delay = Math.round(1600 + Math.random() * 3400);
    st.taps = {};
    st.phase = "arm";
    const n = (st.armN = st.seq++);
    // Po pokazaniu: 2,5 s na reakcję (duch: tyle samo, żeby kusił), potem wyniki.
    later(() => { if (st.armN === n && st.phase === "arm") reveal(st, room); }, st.delay + 2600);
  }

  function reveal(st, room) {
    const res = [];
    for (const p of st.seats) {
      const t = st.taps[p];
      res.push({ pid: p, t: t == null ? null : t, pts: 0 });
    }
    if (st.kind === "pumpkin") {
      res.filter(r => r.t != null && r.t < 0).forEach(r => (r.pts = -1));
      res.filter(r => r.t != null && r.t >= 0).sort((a, b) => a.t - b.t).forEach((r, i) => (r.pts = POINTS[i] || 0));
    } else {
      res.filter(r => r.t != null).forEach(r => (r.pts = -1));
    }
    for (const r of res) st.scores[r.pid] = (st.scores[r.pid] || 0) + r.pts;
    res.sort((a, b) => (a.t == null) - (b.t == null) || (a.t < 0) - (b.t < 0) || (a.t || 0) - (b.t || 0));
    st.last = { n: st.seq++, kind: st.kind, res };
    st.phase = "reveal";
    const n = st.armN;
    later(() => { if (st.armN === n && st.phase === "reveal") nextRound(st, room); }, 4200);
  }

  function action(st, pid, m, room) {
    const host = pid === room.hostId;
    switch (m.a) {
      case "opt":
        if (host && st.phase === "setup" && m.x === "rounds" && ROUNDS.includes(+m.y)) st.opts.rounds = +m.y;
        return;
      case "start":
        if (!host || st.phase === "arm" || st.phase === "reveal") return;
        return start(st, room);
      case "setup":
        if (host) { st.phase = "setup"; st.armN = st.seq++; }
        return;
      case "next": // awaryjnie, gdy host odświeżył stronę i timery przepadły
        if (!host) return;
        if (st.phase === "arm") reveal(st, room); else if (st.phase === "reveal") { st.armN = st.seq++; nextRound(st, room); }
        return;
      case "tap": {
        if (st.phase !== "arm" || +m.x !== st.armN || !st.seats.includes(pid) || st.taps[pid] != null) return;
        let t = Number(m.y);
        if (!isFinite(t)) return;
        t = t >= 0 && t < MIN_HUMAN_MS ? -1 : Math.min(Math.round(t), 9999);
        st.taps[pid] = t;
        // Dynia: gdy wszyscy już dotknęli, nie czekamy na koniec czasu.
        if (st.kind === "pumpkin" && st.seats.every(p => st.taps[p] != null)) reveal(st, room);
        return;
      }
    }
  }

  function playerLeft(st, pid) {
    st.seats = st.seats.filter(p => p !== pid);
    delete st.taps[pid];
  }

  function view(st) {
    return {
      phase: st.phase, opts: st.opts, round: st.round, seats: st.seats, scores: st.scores, kind: st.kind,
      delay: st.delay, armN: st.armN, tapped: Object.keys(st.taps), last: st.last, plays: st.plays,
    };
  }

  // ─────────── Widok (u każdego) ───────────
  const local = { n: null, showAt: 0, tapped: null, timer: null };

  DO.refTap = () => {
    const v = S.view && S.view.game;
    if (!v || v.phase !== "arm" || local.n !== v.armN || local.tapped != null) return;
    const now = performance.now();
    const t = now >= local.showAt ? Math.round(now - local.showAt) : -1;
    local.tapped = t;
    try { navigator.vibrate && navigator.vibrate(t < 0 ? [80, 40, 80] : 30); } catch {}
    act({ a: "tap", x: local.n, y: t });
    window.render();
  };

  function render(v) {
    if (v.phase === "setup") return setupHTML(v);
    return playHTML(v) + (v.phase === "over" ? overHTML(v) : "");
  }

  function setupHTML(v) {
    const host = isHost();
    const online = players().filter(p => p.online);
    const rules = [
      "🌫️ Ekran ciemnieje – <b>czekaj</b>. Po losowej chwili pojawia się <b>dynia 🎃</b>.",
      "⚡ Dotknij ekranu jak najszybciej! Najszybszy dostaje <b>+3</b>, drugi <b>+2</b>, trzeci <b>+1</b>.",
      "👻 Czasem zamiast dyni wyskakuje <b>duch</b> – nie dotykaj go, bo stracisz punkt (−1).",
      "🚫 Dotknięcie przed pojawieniem się dyni to <b>falstart</b> (−1).",
      "⏱️ Czas mierzy Twój telefon od chwili, gdy dynia pojawi się u Ciebie – wolniejszy internet nie przeszkadza.",
    ];
    return `
    <section class="gm-setup fit-screen"><div class="fit-inner">
      <div class="setup-head"><h2 class="spooky">Dyniowy <span class="rf-orange">Refleks</span></h2>${rulesButton()}</div>
      <div class="glass rf-demo"><span class="rf-demo-mist">🌫️</span><span class="rf-arrow">→</span><span class="rf-demo-p">🎃</span><p>Czekaj na dynię… i dotykaj! Ducha 👻 nie ruszaj.</p></div>
      <div class="glass"><div class="me-row">${avatar(me(), "xl")}<div class="me-info"><b>${esc(pName(me()))}</b>${photoButtons()}</div></div></div>
      <div class="glass settings compact">
        <div class="ready-row">${online.map(p => `<span class="rp" title="${esc(p.name)}">${avatar(p.id, "sm")}</span>`).join("")}<span class="lbl">Graczy: ${online.length}</span></div>
        <div class="set-row"><span>Liczba rund</span>
          <div class="seg">${ROUNDS.map(n => `<button class="${v.opts.rounds === n ? "on" : ""}" ${host ? `data-act="opt" data-x="rounds" data-y="${n}"` : "disabled"}>${n}</button>`).join("")}</div></div>
        ${host ? `<button class="btn orange big" data-act="start" ${online.length < 2 ? "disabled" : ""}>🎃 Start</button>` : `<p class="hint wait">⏳ Host zaraz zacznie…</p>`}
      </div>
    </div></section>${rulesModal("Jak grać w Dyniowy Refleks?", rules)}`;
  }

  function scoresHTML(v) {
    return v.seats.slice().sort((a, b) => v.scores[b] - v.scores[a]).map((p, i) => `
      <div class="gm-chip ${v.tapped.includes(p) && v.phase === "arm" ? "turn" : ""}">${avatar(p, "sm")}<div><b>${esc(pName(p))}</b><small>${v.scores[p]} pkt</small></div>${i === 0 && v.scores[p] > 0 ? '<span class="lead">👑</span>' : ""}</div>`).join("");
  }

  function playHTML(v) {
    const meId = me();
    const playing = v.seats.includes(meId);
    if (v.phase === "arm" && local.n !== v.armN) {
      local.n = v.armN;
      local.tapped = null;
      local.showAt = performance.now() + v.delay;
      clearTimeout(local.timer);
      local.timer = setTimeout(() => window.render(), v.delay);
    }
    const shown = v.phase === "arm" && performance.now() >= local.showAt;
    let stage;
    if (v.phase === "arm") {
      const t = local.tapped;
      if (t != null) {
        stage = `<div class="rf-stage done ${t < 0 ? "bad" : ""}">
          <div class="rf-big">${t < 0 ? "😱" : v.kind === "ghost" ? "👻" : "⚡"}</div>
          <h2>${t < 0 ? "Falstart!" : v.kind === "ghost" && shown ? "Duch! Nabrał cię…" : `${t} ms`}</h2>
          <p>${t < 0 ? "Za wcześnie – −1 pkt" : "Czekamy na resztę…"}</p></div>`;
      } else if (!shown) {
        stage = `<button class="rf-stage wait" data-do="refTap"><div class="rf-big mist">🌫️</div><h2>Czekaj…</h2><p>Nie dotykaj, dopóki nie pojawi się dynia!</p></button>`;
      } else if (v.kind === "ghost") {
        stage = `<button class="rf-stage ghost" data-do="refTap"><div class="rf-big pop">👻</div><h2>NIE DOTYKAJ!</h2><p>To duch – zostaw go w spokoju</p></button>`;
      } else {
        stage = `<button class="rf-stage go" data-do="refTap"><div class="rf-big pop">🎃</div><h2>DOTKNIJ!</h2></button>`;
      }
      if (!playing) stage = `<div class="rf-stage wait"><div class="rf-big mist">👀</div><h2>Oglądasz rundę</h2><p>Dołączysz w następnej grze.</p></div>`;
    } else if (v.last) {
      const L = v.last;
      stage = `<div class="rf-stage reveal">
        <h3>${L.kind === "ghost" ? "👻 To był duch!" : "🎃 Wyniki rundy"}</h3>
        <ol class="rf-res">${L.res.map(r => `<li class="${r.pts > 0 ? "good" : r.pts < 0 ? "bad" : ""}">${avatar(r.pid, "sm")}<span>${esc(pName(r.pid))}</span>
          <em>${r.t == null ? (L.kind === "ghost" ? "nie dał się 👍" : "brak") : r.t < 0 ? "falstart" : `${r.t} ms`}</em>
          <b>${r.pts > 0 ? "+" + r.pts : r.pts < 0 ? r.pts : "0"}</b></li>`).join("")}</ol>
        ${v.phase === "reveal" ? '<p class="hint">Następna runda za chwilę…</p>' : ""}
      </div>`;
    } else stage = `<div class="rf-stage wait"><div class="rf-big mist">🌫️</div></div>`;
    return `
    <section class="rf-table fit-screen">
      <div class="gm-chips" data-keep="rfchips">${scoresHTML(v)}</div>
      <div class="rf-round">Runda <b>${v.round}</b> / ${v.opts.rounds}</div>
      ${stage}
    </section>`;
  }

  function overHTML(v) {
    const rank = v.seats.slice().sort((a, b) => v.scores[b] - v.scores[a]);
    const w = rank[0];
    const medal = i => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
    return `<div class="over-veil"><div class="glass over">
      <div class="crown">⚡</div>${avatar(w, "xxl")}
      <h2 class="spooky">${esc(pName(w))}<br><span>najszybsza ręka!</span></h2>
      <ol class="ranking">${rank.map((p, i) => `<li>${medal(i)} ${avatar(p, "xs")} <span>${esc(pName(p))}</span><b>${v.scores[p]} pkt</b></li>`).join("")}</ol>
      ${isHost() ? `<div class="over-btns"><button class="btn orange" data-act="start">🔁 Jeszcze raz</button><button class="btn ghost" data-act="setup">⚙️ Ustawienia</button><button class="btn ghost small" data-act="room.lobby">🏚️ Lobby</button></div>`
        : `<p class="hint wait">⏳ Host zdecyduje, co dalej…</p>`}
    </div></div>`;
  }

  function hostMenu(v) {
    const items = [];
    if (v.phase === "arm" || v.phase === "reveal") items.push({ label: "⏩ Dalej (gdy runda utknie)", act: "next" });
    if (v.phase !== "setup") items.push({ label: "⚙️ Przerwij i wróć do ustawień", act: "setup" });
    return items;
  }

  function effects(prev, v) {
    if (v && v.phase === "over" && (!prev || prev.phase !== "over")) { try { navigator.vibrate && navigator.vibrate([80, 60, 120]); } catch {} }
  }

  registerGame({
    id: "refleks", name: "Dyniowy Refleks", emoji: "🎃",
    tagline: "Czekaj na dynię i dotknij najszybciej – ale ducha nie ruszaj! Gra na refleks dla całej ekipy.",
    min: 2, max: 10,
    create, action, view, render, playerLeft, hostMenu, effects,
  });
})();
