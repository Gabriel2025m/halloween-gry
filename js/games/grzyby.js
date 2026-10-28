"use strict";
// ═════════════ Upiorne Grzybobranie ═════════════
// Własne zasady: każdy rzuca kostką i idzie nawiedzoną leśną ścieżką do Chatki.
// Pola z grzybem dają kartę z lasu (grzyby jadalne = punkty, muchomor zabiera najlepszy grzyb),
// pola specjalne przesuwają, zatrzymują albo pozwalają podkraść grzyba liderowi.
// Gra kończy się, gdy wszyscy dojdą do Chatki – wygrywa najpełniejszy koszyk.
(() => {
  const MUSHROOMS = {
    zloty: { name: "Złoty grzyb", pts: 5, cap: "#ffd23f", stem: "#fff3c4", glow: true },
    prawdziwek: { name: "Prawdziwek", pts: 3, cap: "#7a4a24", stem: "#f1e3c6" },
    podgrzybek: { name: "Podgrzybek", pts: 2, cap: "#4a2f1d", stem: "#e9d3a8" },
    kurka: { name: "Kurka", pts: 1, cap: "#ffb020", stem: "#ffcf5c", funnel: true },
    muchomor: { name: "Muchomor", pts: 0, poison: true },
  };
  const DECK = { zloty: 3, prawdziwek: 10, podgrzybek: 14, kurka: 16, muchomor: 9 };
  const FIELDS = {
    start: { icon: "🏚️", name: "Start" },
    chatka: { icon: "🛖", name: "Chatka", desc: "Meta! Pierwsi dostają premię: +3, +2, +1." },
    grzyb: { icon: "🍄", name: "Grzyb", desc: "Zbierasz grzyba z lasu." },
    nietoperz: { icon: "🦇", name: "Nietoperz", desc: "Przenosi cię 3 pola do przodu." },
    duch: { icon: "👻", name: "Duch", desc: "Straszy – cofasz się o 3 pola." },
    mgla: { icon: "🌫️", name: "Mgła", desc: "Gubisz drogę – tracisz następną kolejkę." },
    wiedzma: { icon: "🧙", name: "Wiedźma", desc: "Podkradasz losowego grzyba liderowi." },
    dynia: { icon: "🎃", name: "Dynia", desc: "Rzucasz jeszcze raz!" },
  };
  const BONUS = [3, 2, 1];
  const LENGTHS = [30, 40, 50];

  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const nameIn = (room, pid) => (room.players.find(p => p.id === pid) || {}).name || "Ktoś";
  const pts = cards => cards.reduce((s, c) => s + MUSHROOMS[c.t].pts, 0);

  // Ścieżka: start, chatka na końcu, w środku głównie grzyby, pola specjalne nie stoją obok siebie.
  function makeBoard(len) {
    const specials = ["nietoperz", "duch", "mgla", "wiedzma", "dynia"];
    const b = ["start"];
    for (let i = 1; i < len - 1; i++) {
      const prevSpecial = b[i - 1] !== "grzyb" && b[i - 1] !== "start";
      b.push(!prevSpecial && i > 2 && Math.random() < 0.42 ? specials[Math.floor(Math.random() * specials.length)] : "grzyb");
    }
    b.push("chatka");
    return b;
  }

  function newDeck(st) {
    let id = st.cardSeq || 1;
    const d = [];
    for (const [t, n] of Object.entries(DECK)) for (let i = 0; i < n; i++) d.push({ id: id++, t });
    st.cardSeq = id;
    return shuffle(d);
  }

  // ─────────── Silnik (u hosta) ───────────
  function create(room, prev) {
    return {
      phase: "setup", opts: prev ? prev.opts : { len: 40 }, round: prev ? prev.round : 0,
      board: [], seats: [], pos: {}, basket: {}, bonus: {}, skip: {}, done: [], turn: 0,
      deck: [], used: [], roll: null, event: null, log: [], seq: 1, cardSeq: 1,
    };
  }

  const cur = st => st.seats[st.turn];
  function log(st, txt, kind = "") { st.log.push({ n: st.seq++, txt, kind }); if (st.log.length > 12) st.log.shift(); }
  const score = (st, pid) => pts(st.basket[pid] || []) + (st.bonus[pid] || 0);

  function draw(st) {
    if (!st.deck.length) { st.deck = shuffle(st.used); st.used = []; }
    if (!st.deck.length) st.deck = newDeck(st);
    return st.deck.pop();
  }

  function start(st, room) {
    const seats = room.players.filter(p => p.online).map(p => p.id);
    if (seats.length < 2) return "Potrzeba co najmniej 2 graczy.";
    Object.assign(st, {
      seats: shuffle(seats), board: makeBoard(st.opts.len), pos: {}, basket: {}, bonus: {}, skip: {}, done: [],
      turn: 0, deck: [], used: [], roll: null, event: null, log: [], phase: "play",
    });
    st.deck = newDeck(st);
    for (const p of st.seats) { st.pos[p] = 0; st.basket[p] = []; }
    st.round++;
    log(st, `🧺 Ruszamy na grzyby! Zaczyna ${nameIn(room, cur(st))}.`);
  }

  function setEvent(st, pid, type, txt, extra = {}) { st.event = { n: st.seq, pid, type, txt, ...extra }; log(st, txt, type); }

  // Rozpatrzenie pola, na którym stanął gracz (pola przesuwające mogą prowadzić na kolejne pole).
  function resolve(st, pid, room, depth = 0) {
    const nm = nameIn(room, pid);
    const last = st.board.length - 1;
    if (st.pos[pid] >= last) return arrive(st, pid, room);
    const f = st.board[st.pos[pid]];
    if (f === "grzyb") {
      const c = draw(st);
      const m = MUSHROOMS[c.t];
      if (m.poison) {
        const b = st.basket[pid];
        if (b.length) {
          b.sort((x, y) => MUSHROOMS[x.t].pts - MUSHROOMS[y.t].pts);
          const lost = b.pop();
          st.used.push(lost);
          setEvent(st, pid, "poison", `🍄 ${nm} trafia na muchomora i wyrzuca ${MUSHROOMS[lost.t].name.toLowerCase()} (−${MUSHROOMS[lost.t].pts})`, { card: c, lost });
        } else setEvent(st, pid, "poison", `🍄 ${nm} trafia na muchomora – na szczęście koszyk jest pusty`, { card: c });
        st.used.push(c);
      } else {
        st.basket[pid].push(c);
        setEvent(st, pid, "find", `${nm} znajduje: ${m.name} (+${m.pts})`, { card: c });
      }
    } else if (f === "nietoperz" && depth < 3) {
      st.pos[pid] = Math.min(last, st.pos[pid] + 3);
      setEvent(st, pid, "move", `🦇 Nietoperz przenosi ${nm} 3 pola dalej`);
      return resolve(st, pid, room, depth + 1);
    } else if (f === "duch" && depth < 3) {
      st.pos[pid] = Math.max(0, st.pos[pid] - 3);
      setEvent(st, pid, "move", `👻 Duch straszy – ${nm} cofa się o 3 pola`);
      if (st.pos[pid] > 0) return resolve(st, pid, room, depth + 1);
    } else if (f === "mgla") {
      st.skip[pid] = (st.skip[pid] || 0) + 1;
      setEvent(st, pid, "fog", `🌫️ ${nm} gubi się we mgle i traci kolejkę`);
    } else if (f === "wiedzma") {
      const rivals = st.seats.filter(p => p !== pid && st.basket[p].length);
      if (!rivals.length) setEvent(st, pid, "witch", `🧙 Wiedźma szuka, ale nikt nie ma jeszcze grzybów`);
      else {
        const leader = rivals.sort((a, b) => score(st, b) - score(st, a))[0];
        const b = st.basket[leader];
        const c = b.splice(Math.floor(Math.random() * b.length), 1)[0];
        st.basket[pid].push(c);
        setEvent(st, pid, "witch", `🧙 Wiedźma pomaga ${nm} podkraść ${MUSHROOMS[c.t].name.toLowerCase()} od ${nameIn(room, leader)}`, { card: c, from: leader });
      }
    } else if (f === "dynia") {
      setEvent(st, pid, "again", `🎃 Dynia! ${nm} rzuca jeszcze raz`);
      return "again";
    }
  }

  function arrive(st, pid, room) {
    st.pos[pid] = st.board.length - 1;
    if (st.done.includes(pid)) return;
    st.done.push(pid);
    const place = st.done.length;
    const b = BONUS[place - 1] || 0;
    if (b) st.bonus[pid] = (st.bonus[pid] || 0) + b;
    setEvent(st, pid, "home", `🛖 ${nameIn(room, pid)} dociera do Chatki jako ${place}.${b ? ` (+${b})` : ""}`);
  }

  // Następna osoba, która jeszcze idzie; mgła zabiera kolejkę.
  function nextTurn(st, room) {
    const active = st.seats.filter(p => !st.done.includes(p));
    if (!active.length) return finish(st, room);
    for (let guard = 0; guard < st.seats.length * 3; guard++) {
      st.turn = (st.turn + 1) % st.seats.length;
      const p = cur(st);
      if (st.done.includes(p)) continue;
      if (st.skip[p] > 0) { st.skip[p]--; log(st, `🌫️ ${nameIn(room, p)} czeka we mgle`); continue; }
      return;
    }
  }

  function finish(st, room) {
    st.phase = "over";
    st.ranking = st.seats.map(p => ({ pid: p, score: score(st, p), n: st.basket[p].length, bonus: st.bonus[p] || 0 }))
      .sort((a, b) => b.score - a.score || st.done.indexOf(a.pid) - st.done.indexOf(b.pid));
    st.winner = st.ranking[0] && st.ranking[0].pid;
    log(st, `🏆 ${nameIn(room, st.winner)} ma najpełniejszy koszyk!`, "win");
  }

  function roll(st, pid, room) {
    if (pid !== cur(st)) return "Poczekaj na swoją kolejkę ⏳";
    const val = 1 + Math.floor(Math.random() * 6);
    const from = st.pos[pid];
    st.pos[pid] = Math.min(st.board.length - 1, from + val);
    st.roll = { pid, val, n: st.seq };
    log(st, `🎲 ${nameIn(room, pid)} wyrzuca ${val}`, "roll");
    st.event = null;
    const r = resolve(st, pid, room);
    if (r === "again" && !st.done.includes(pid)) return;
    nextTurn(st, room);
  }

  function action(st, pid, m, room) {
    const host = pid === room.hostId;
    switch (m.a) {
      case "opt":
        if (!host || st.phase !== "setup") return;
        if (m.x === "len" && LENGTHS.includes(+m.y)) st.opts.len = +m.y;
        return;
      case "start":
        if (!host || st.phase === "play") return;
        return start(st, room);
      case "setup":
        if (host) st.phase = "setup";
        return;
      case "roll":
        if (st.phase !== "play") return;
        return roll(st, pid, room);
      case "skip":
        if (!host || st.phase !== "play") return;
        log(st, `⏭️ Host pomija kolejkę: ${nameIn(room, cur(st))}`);
        nextTurn(st, room);
        return;
    }
  }

  function playerLeft(st, pid, room) {
    const i = st.seats.indexOf(pid);
    if (st.phase !== "play" || i < 0) return;
    const wasTurn = i === st.turn;
    st.used.push(...(st.basket[pid] || []));
    st.seats.splice(i, 1);
    st.done = st.done.filter(p => p !== pid);
    if (i < st.turn) st.turn--;
    log(st, `👋 ${nameIn(room, pid)} opuszcza las`);
    if (!st.seats.length) { st.phase = "setup"; return; }
    if (st.turn >= st.seats.length) st.turn = 0;
    if (wasTurn || st.done.includes(cur(st))) { st.turn = (st.turn - 1 + st.seats.length) % st.seats.length; nextTurn(st, room); }
    if (st.phase === "play" && st.seats.every(p => st.done.includes(p))) finish(st, room);
  }

  function view(st) {
    const scores = {};
    for (const p of st.seats) scores[p] = score(st, p);
    return {
      phase: st.phase, opts: st.opts, round: st.round, board: st.board, seats: st.seats, pos: st.pos,
      basket: st.basket, bonus: st.bonus, skip: st.skip, done: st.done, turn: cur(st), scores,
      roll: st.roll, event: st.event, log: st.log.slice(-6), deck: st.deck.length,
      ranking: st.ranking || null, winner: st.winner || null,
    };
  }

  // ─────────── Widok (u każdego) ───────────
  function mushSVG(t, size = 44) {
    const m = MUSHROOMS[t];
    if (m.poison) return `<span class="gm-emoji" style="font-size:${size * 0.85}px">🍄</span>`;
    const cap = m.funnel
      ? `<path d="M10 22 Q32 6 54 22 Q44 30 32 30 Q20 30 10 22Z" fill="${m.cap}"/>`
      : `<path d="M6 30 Q8 8 32 8 Q56 8 58 30 Q32 36 6 30Z" fill="${m.cap}"/><ellipse cx="22" cy="17" rx="7" ry="3" fill="#fff" opacity=".18"/>`;
    return `<svg class="gm-svg ${m.glow ? "glow" : ""}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M24 30 Q22 50 20 56 Q32 60 44 56 Q42 50 40 30Z" fill="${m.stem}"/>${cap}</svg>`;
  }

  function cardHTML(c, cls = "") {
    const m = MUSHROOMS[c.t];
    return `<div class="gcard ${c.t} ${cls}">${mushSVG(c.t, 40)}<b>${m.name}</b><small>${m.poison ? "trujący!" : `+${m.pts} pkt`}</small></div>`;
  }

  // Ścieżka węża: 6 kolumn, kolejne rzędy w przeciwną stronę.
  const COLS = 6;
  const cellPos = i => { const r = Math.floor(i / COLS); const c = r % 2 ? COLS - 1 - (i % COLS) : i % COLS; return { r, c }; };

  function render(v) {
    if (v.phase === "setup") return setupHTML(v);
    return playHTML(v) + (v.phase === "over" ? overHTML(v) : "");
  }

  function setupHTML(v) {
    const host = isHost();
    const list = players();
    const online = list.filter(p => p.online);
    const rules = [
      "🎲 Po kolei rzucacie kostką i idziecie leśną ścieżką do <b>Chatki 🛖</b>.",
      "🍄 Pole z grzybem: ciągniesz kartę z lasu – <b>Złoty grzyb +5</b>, <b>Prawdziwek +3</b>, <b>Podgrzybek +2</b>, <b>Kurka +1</b>. Uwaga na <b>muchomora</b> – wyrzucasz z koszyka najcenniejszego grzyba!",
      "🦇 Nietoperz: 3 pola do przodu · 👻 Duch: 3 pola wstecz · 🌫️ Mgła: tracisz kolejkę · 🎃 Dynia: rzucasz jeszcze raz · 🧙 Wiedźma: podkradasz grzyba liderowi.",
      "🛖 Kto pierwszy w Chatce, dostaje premię +3 (potem +2, +1). Gra trwa, aż wszyscy dojdą – wygrywa najpełniejszy koszyk.",
    ];
    return `
    <section class="gm-setup fit-screen"><div class="fit-inner">
      <div class="setup-head"><h2 class="spooky">Upiorne <span class="gm-green">Grzybobranie</span></h2>${rulesButton()}</div>
      <div class="glass">
        <h3>Twój pionek</h3>
        <div class="me-row">
          ${avatar(me(), "xl")}
          ${photoButtons()}
        </div>
      </div>
      <div class="glass settings compact">
        <div class="ready-row">
          ${online.map(p => `<span class="rp" title="${esc(p.name)}">${avatar(p.id, "sm")}</span>`).join("")}
          <span class="lbl">Grzybiarze: ${online.length}</span>
        </div>
        <div class="set-row"><span>Długość ścieżki</span>
          <div class="seg">${LENGTHS.map(n => `<button class="${v.opts.len === n ? "on" : ""}" ${host ? `data-act="opt" data-x="len" data-y="${n}"` : "disabled"}>${n}</button>`).join("")}</div></div>
        ${host ? `<button class="btn orange big" data-act="start" ${online.length < 2 ? "disabled" : ""}>🧺 Ruszamy do lasu</button>`
          : `<p class="hint wait">⏳ Host zaraz wyruszy…</p>`}
      </div>
    </div></section>${rulesModal("Jak grać w Upiorne Grzybobranie?", rules)}`;
  }

  const seen = { roll: null, event: null };
  // Animacja po stronie przeglądarki: pionki idą pole po polu do pozycji z serwera.
  const STEP_MS = 190;
  const anim = { shown: {}, round: null, timer: null, v: null, tip: null, tipTimer: null };
  const DICE = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

  const shownPos = (v, p) => (anim.shown[p] != null ? anim.shown[p] : v.pos[p] || 0);
  function pawnXY(v, p, rows) {
    const i = shownPos(v, p);
    const k = v.seats.filter(q => q !== p && shownPos(v, q) === i && v.seats.indexOf(q) < v.seats.indexOf(p)).length;
    const { r, c } = cellPos(i);
    const dx = (k % 3) * 9 - 9, dy = Math.floor(k / 3) * 7;
    return { left: `calc(${((c + 0.5) / COLS) * 100}% + ${dx}px)`, top: `calc(${((r + 0.62) / rows) * 100}% + ${dy}px)` };
  }

  function stepPawns() {
    anim.timer = null;
    const v = anim.v;
    if (!v || v.phase === "setup") return;
    const rows = Math.ceil(v.board.length / COLS);
    let moving = false;
    for (const p of v.seats) {
      const t = v.pos[p] || 0, s = shownPos(v, p);
      if (s === t) continue;
      moving = true;
      anim.shown[p] = s + Math.sign(t - s);
      const el = document.querySelector(`[data-key="pw-${p}"]`);
      if (el) {
        const xy = pawnXY(v, p, rows);
        el.style.left = xy.left; el.style.top = xy.top;
        el.classList.remove("hop"); void el.offsetWidth; el.classList.add("hop");
      }
    }
    if (moving) anim.timer = setTimeout(stepPawns, STEP_MS);
    else window.render(); // koniec marszu – pokaż zdarzenie z pola i podświetl możliwe ruchy (render całej aplikacji)
  }

  DO.gmCell = el => {
    anim.tip = +el.dataset.x;
    clearTimeout(anim.tipTimer);
    anim.tipTimer = setTimeout(() => { anim.tip = null; window.render(); }, 2600);
    window.render();
  };

  function diceHTML(v, myTurn, fresh) {
    const val = v.roll ? v.roll.val : 1;
    const [rx, ry] = DICE[val];
    const faces = [1, 2, 3, 4, 5, 6].map(n => `<div class="face f${n}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<i class="${PIPS[n].includes(i) ? "on" : ""}"></i>`).join("")}</div>`).join("");
    return `<button class="gm-dice3d ${fresh ? "roll" : ""} ${myTurn ? "ready" : ""} ${v.roll ? "" : "idle"}" ${myTurn ? 'data-act="roll" aria-label="Rzuć kostką"' : "disabled"}
      data-key="dice${v.roll ? v.roll.n : 0}" style="--rx:${rx}deg;--ry:${ry}deg"><div class="cube">${faces}</div></button>`;
  }

  function playHTML(v) {
    const meId = me();
    const myTurn = v.phase === "play" && v.turn === meId;
    const rows = Math.ceil(v.board.length / COLS);
    if (anim.round !== v.round) { anim.round = v.round; anim.shown = {}; }
    const walking = v.seats.some(p => anim.shown[p] != null && anim.shown[p] !== v.pos[p]);
    const myPos = shownPos(v, meId);
    const reach = myTurn && !walking ? new Set([1, 2, 3, 4, 5, 6].map(d => Math.min(v.board.length - 1, myPos + d))) : new Set();

    const cells = v.board.map((f, i) => {
      const { r, c } = cellPos(i);
      const k = i - myPos;
      return `<div class="gm-cell f-${f} ${reach.has(i) ? "reach" : ""} ${anim.tip === i ? "tipped" : ""}" style="grid-row:${r + 1};grid-column:${c + 1};--k:${k}"
        data-do="gmCell" data-x="${i}"><span>${FIELDS[f].icon}</span><i>${i || ""}</i></div>`;
    }).join("");
    const pawns = v.seats.map(p => {
      const xy = pawnXY(v, p, rows);
      return `<div class="gm-pawn ${p === v.turn && v.phase === "play" && !walking ? "turn" : ""} ${p === meId ? "mine" : ""}" data-key="pw-${esc(p)}"
        style="left:${xy.left};top:${xy.top}">${avatar(p, "sm")}<i class="base"></i></div>`;
    }).join("");
    const tip = anim.tip != null && v.board[anim.tip] ? (() => { const f = FIELDS[v.board[anim.tip]];
      return `<div class="gm-tip"><span>${f.icon}</span><div><b>${anim.tip ? `Pole ${anim.tip}: ` : ""}${f.name}</b><small>${f.desc || "Tu wszyscy zaczynają wyprawę."}</small></div></div>`; })() : "";
    const flies = '<i class="ff"></i>'.repeat(9);

    const freshRoll = v.roll && seen.roll !== v.roll.n;
    seen.roll = v.roll ? v.roll.n : null;
    const ev = v.event;
    const evWalking = ev && anim.shown[ev.pid] != null && anim.shown[ev.pid] !== v.pos[ev.pid];
    const freshEv = ev && !evWalking && seen.event !== ev.n;
    if (!evWalking) seen.event = ev ? ev.n : null;

    const chips = v.seats.slice().sort((a, b) => v.scores[b] - v.scores[a]).map((p, i) => `
      <div class="gm-chip ${p === v.turn && v.phase === "play" ? "turn" : ""}">
        ${avatar(p, "sm")}<div><b>${esc(pName(p))}</b><small>${v.scores[p]} pkt · 🧺 ${(v.basket[p] || []).length}${v.done.includes(p) ? ` · 🛖${v.done.indexOf(p) + 1}.` : ""}${v.skip[p] ? " · 🌫️" : ""}</small></div>
        ${i === 0 && v.scores[p] > 0 ? '<span class="lead">👑</span>' : ""}
      </div>`).join("");

    const evHTML = evWalking
      ? `<div class="gm-event walking"><span class="ev-icon">🚶</span><p>${esc(pName(ev.pid))} idzie przez las…</p></div>`
      : ev ? `<div class="gm-event ${ev.type} ${freshEv ? "pop" : ""}" data-key="ev${ev.n}">
        ${ev.card ? cardHTML(ev.card, "small") : `<span class="ev-icon">${{ move: "🦇", fog: "🌫️", again: "🎃", home: "🛖", witch: "🧙" }[ev.type] || "🍂"}</span>`}
        <p>${esc(ev.txt)}</p></div>` : `<div class="gm-event"><span class="ev-icon">🍂</span><p>Las czeka na pierwszy rzut…</p></div>`;

    const myBasket = (v.basket[meId] || []);
    const done = v.done.includes(meId);

    return `
    <section class="gm-table fit-screen ${myTurn ? "my-turn" : ""}">
      <div class="gm-chips" data-keep="gmchips">${chips}</div>
      <div class="gm-boardwrap"><div class="gm-board" style="--rows:${rows};grid-template-rows:repeat(${rows},1fr)">${cells}<div class="gm-pawns">${pawns}</div><div class="gm-flies">${flies}</div></div>${tip}</div>
      <div class="gm-panel glass">
        <div class="gm-turn">${v.phase !== "play" ? "Koniec grzybobrania" : myTurn ? (walking ? "Idziesz…" : "Twoja kolej – dotknij kostki!") : `Rzuca: ${avatar(v.turn, "xs")} <b>${esc(pName(v.turn))}</b>`}</div>
        <div class="gm-mid">${diceHTML(v, myTurn && !walking, freshRoll)}${evHTML}</div>
        ${myTurn && !walking ? `<button class="btn orange big gm-roll" data-act="roll">🎲 Rzuć kostką</button>` : ""}
        ${v.seats.includes(meId) ? `<div class="gm-basket"><span class="bk-label">🧺${done ? ` 🛖${v.done.indexOf(meId) + 1}.` : ""}</span>
          <span class="bk-list">${myBasket.length ? myBasket.map(c => `<span class="bk" title="${MUSHROOMS[c.t].name}">${mushSVG(c.t, 24)}</span>`).join("") : '<em>koszyk pusty… na razie</em>'}</span>
          <b>${v.scores[meId] || 0} pkt</b></div>` : '<p class="hint">👀 Oglądasz tę wyprawę – dołączysz w następnej.</p>'}
        <ul class="feed">${v.log.slice(-2).reverse().map((l, i) => `<li class="${l.kind} ${i ? "" : "newest"}">${esc(l.txt)}</li>`).join("")}</ul>
      </div>
    </section>`;
  }

  function overHTML(v) {
    const w = v.winner;
    const medal = i => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
    return `<div class="over-veil"><div class="glass over">
      <div class="crown">🧺</div>
      ${avatar(w, "xxl")}
      <h2 class="spooky">${esc(pName(w))}<br><span>wygrywa!</span></h2>
      <ol class="ranking">${(v.ranking || []).map((r, i) => `<li>${medal(i)} ${avatar(r.pid, "xs")} <span>${esc(pName(r.pid))}</span>
        <b>${r.score} pkt</b></li>`).join("")}</ol>
      <p class="hint">Punkty = grzyby w koszyku + premia za dojście do Chatki.</p>
      ${isHost() ? `<div class="over-btns"><button class="btn orange" data-act="start">🔁 Nowa wyprawa</button><button class="btn ghost" data-act="setup">⚙️ Ustawienia</button><button class="btn ghost small" data-act="room.lobby">🏚️ Lobby</button></div>`
        : `<p class="hint wait">⏳ Host zdecyduje, co dalej…</p>`}
    </div></div>`;
  }

  function hostMenu(v) {
    const items = [];
    if (v.phase === "play") items.push({ label: `⏭️ Pomiń kolejkę: ${esc(pName(v.turn))}`, act: "skip" });
    if (v.phase !== "setup") items.push({ label: "⚙️ Przerwij i wróć do ustawień", act: "setup" });
    return items;
  }

  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  function effects(prev, v) {
    if (!v) return;
    const meId = me();
    if (v.phase !== "setup") {
      for (const p of v.seats) if (anim.shown[p] == null) anim.shown[p] = v.pos[p] || 0;
      anim.v = v;
      if (!anim.timer && v.seats.some(p => anim.shown[p] !== v.pos[p])) anim.timer = setTimeout(stepPawns, 350);
    }
    if (v.phase === "play" && v.turn === meId && (!prev || prev.turn !== meId || (prev.roll && v.roll && prev.roll.n !== v.roll.n))) buzz(60);
    if (v.phase === "over" && (!prev || prev.phase !== "over")) buzz([80, 60, 120]);
    if (v.event && v.event.pid === meId && (!prev || !prev.event || prev.event.n !== v.event.n)) {
      if (v.event.type === "poison") buzz([120, 50, 120]);
      if (v.event.type === "move" && /Duch/.test(v.event.txt)) { document.body.classList.remove("shake"); void document.body.offsetWidth; document.body.classList.add("shake"); }
    }
  }

  registerGame({
    id: "grzyby", name: "Upiorne Grzybobranie", emoji: "🍄",
    tagline: "Rzuć kostką, idź nawiedzonym lasem i zbierz najpełniejszy koszyk – uważaj na muchomory i duchy.",
    min: 2, max: 10,
    create, action, view, render, playerLeft, hostMenu, effects,
  });
})();
