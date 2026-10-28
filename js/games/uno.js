"use strict";
// ═════════════ Upiorne UNO ═════════════
// Każdy gracz = jeden kolor z jego twarzą na kartach 1–9. Jedyna karta specjalna: +3.
// Opcjonalnie „pary”: kolory dwóch osób z pary można kłaść na siebie (jedna karta na turę).
(() => {
  const P3 = "P3";
  const COLORS = [
    { name: "Dyniowy", hex: "#ff7a1a", emoji: "🎃" },
    { name: "Fiolet", hex: "#9b5cff", emoji: "🔮" },
    { name: "Toksyczny", hex: "#3ee45f", emoji: "🧪" },
    { name: "Krwisty", hex: "#e8233a", emoji: "🩸" },
    { name: "Lodowy", hex: "#2fc3ff", emoji: "👻" },
    { name: "Świecowy", hex: "#ffd23f", emoji: "🕯️" },
    { name: "Wiedźmi róż", hex: "#ff4fb8", emoji: "🧙" },
    { name: "Bagienny", hex: "#14d2b0", emoji: "🐸" },
    { name: "Kościany", hex: "#efe7d4", emoji: "💀" },
    { name: "Zombie", hex: "#b6ff3b", emoji: "🧟" },
  ];
  const COPIES = 2; // każda liczba 1–9 i +3 występuje 2× w każdym kolorze

  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const nameIn = (room, pid) => (room.players.find(p => p.id === pid) || {}).name || "Ktoś";
  const cardsWord = n => (n === 1 ? "karta" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "karty" : "kart");
  const label = c => (c.v === P3 ? "+3" : String(c.v));

  // cfg = { opts, pairs, colors } – działa zarówno na stanie hosta, jak i na widoku gracza.
  function paired(cfg, a, b) {
    if (!cfg.opts.pairs || a === b) return false;
    return cfg.pairs.some(([x, y]) => x && y && x !== y && cfg.colors[x] != null && cfg.colors[y] != null &&
      ((cfg.colors[x] === a && cfg.colors[y] === b) || (cfg.colors[x] === b && cfg.colors[y] === a)));
  }
  function canPlay(cfg, card, top, pending) {
    if (pending > 0) return card.v === P3 && cfg.opts.stack;
    if (!top) return true;
    return card.k === top.k || card.v === top.v || paired(cfg, card.k, top.k);
  }

  // ─────────── Silnik (u hosta) ───────────
  function create(room, prev) {
    return {
      phase: "setup", round: prev ? prev.round : 0,
      opts: prev ? prev.opts : { hand: 7, stack: false, pairs: false },
      pairs: prev ? prev.pairs : [["", ""], ["", ""]],
      colors: prev ? prev.colors : {},
      seats: [], hands: {}, deck: [], discard: [], turn: 0, pending: 0, drew: null,
      uno: {}, vuln: null, log: [], winner: null, ranking: null, shout: null, last: null, seq: 1,
      finished: [], done: null, loser: null,
    };
  }

  const top = st => (st.discard.length ? st.discard[st.discard.length - 1].card : null);
  const cur = st => st.seats[st.turn];
  function log(st, txt, kind = "", extra) { st.log.push({ n: st.seq++, txt, kind, ...extra }); if (st.log.length > 12) st.log.shift(); }

  function draw1(st) {
    if (!st.deck.length && st.discard.length > 1) {
      const keep = st.discard.pop();
      st.deck = shuffle(st.discard.map(d => d.card));
      st.discard = [keep];
      log(st, "🔄 Talia przetasowana");
    }
    return st.deck.pop() || null;
  }
  function give(st, pid, n) {
    let got = 0;
    for (let i = 0; i < n; i++) { const c = draw1(st); if (!c) break; st.hands[pid].push(c); got++; }
    if (st.hands[pid].length > 1) st.uno[pid] = false;
    return got;
  }
  function advance(st) { st.turn = (st.turn + 1) % st.seats.length; st.drew = null; }
  // Okno na „Złap!” zamyka się, gdy ktoś inny wykona ruch.
  function closeCatch(st, actor) { if (st.vuln && st.vuln !== actor) st.vuln = null; }
  function tidy(st) { if (st.vuln && (!st.hands[st.vuln] || st.hands[st.vuln].length !== 1)) st.vuln = null; }

  function start(st, room) {
    const online = new Set(room.players.filter(p => p.online).map(p => p.id));
    const seats = room.players.filter(p => st.colors[p.id] != null && online.has(p.id)).map(p => p.id);
    if (seats.length < 2) return "Potrzeba co najmniej 2 graczy z wybranym kolorem.";
    let id = 1;
    const deck = [];
    for (const pid of seats) {
      const k = st.colors[pid];
      for (let c = 0; c < COPIES; c++) {
        for (let v = 1; v <= 9; v++) deck.push({ id: id++, k, v });
        deck.push({ id: id++, k, v: P3 });
      }
    }
    shuffle(deck);
    Object.assign(st, { seats, deck, hands: {}, discard: [], pending: 0, drew: null, uno: {}, vuln: null, log: [], winner: null, ranking: null, shout: null, last: null, finished: [], done: null, loser: null });
    for (const pid of seats) st.hands[pid] = deck.splice(0, st.opts.hand);
    let first = deck.pop();
    while (first.v === P3) { deck.unshift(first); first = deck.pop(); }
    st.discard.push({ card: first, by: null });
    st.turn = st.round % seats.length;
    st.round++;
    st.phase = "play";
    log(st, `🃏 Rozdano po ${st.opts.hand} kart. Zaczyna ${nameIn(room, cur(st))}!`);
  }

  const medal = place => ["🥇", "🥈", "🥉"][place - 1] || "🏅";

  // Gracz bez kart schodzi ze stołu, kolejka przesuwa się bez niego.
  function leaveSeats(st, pid) {
    const i = st.seats.indexOf(pid);
    if (i < 0) return;
    st.seats.splice(i, 1);
    if (i < st.turn) st.turn--;
    if (st.turn >= st.seats.length) st.turn = 0;
  }

  // Runda trwa, dopóki przy stole zostanie jedna osoba – ona przegrywa.
  function endGame(st, room) {
    const rest = st.seats.map(p => ({ pid: p, n: (st.hands[p] || []).length })).sort((a, b) => a.n - b.n);
    st.ranking = st.finished.map(p => ({ pid: p, n: 0 })).concat(rest);
    st.winner = st.finished[0] || (rest[0] && rest[0].pid) || null;
    st.loser = rest.length ? rest[rest.length - 1].pid : null;
    st.phase = "over";
    if (st.loser && st.finished.length) log(st, `👻 ${nameIn(room, st.loser)} zostaje z kartami!`, "win");
  }

  function play(st, pid, cardId, room) {
    if (pid !== cur(st)) return "Poczekaj na swoją turę ⏳";
    const hand = st.hands[pid];
    const i = hand.findIndex(c => c.id === cardId);
    if (i < 0) return;
    if (st.drew != null && st.drew !== cardId) return "Możesz zagrać tylko dobraną kartę albo spasować.";
    const card = hand[i];
    const t = top(st);
    if (!canPlay(st, card, t, st.pending)) return st.pending ? `Musisz przebić +3 albo dobrać ${st.pending}.` : "Ta karta tu nie pasuje 👻";
    closeCatch(st, pid);
    const pair = !!t && card.k !== t.k && card.v !== t.v;
    hand.splice(i, 1);
    st.discard.push({ card, by: pid, pair });
    st.last = { n: st.seq, by: pid };
    const nm = nameIn(room, pid);
    log(st, `${nm} kładzie ${label(card)}${pair ? " 💞 (para)" : ""}`, "play", { by: pid, card, pair });
    const out = hand.length === 0;
    if (out) {
      st.finished.push(pid);
      st.done = { pid, place: st.finished.length, n: st.seq };
      log(st, `${medal(st.finished.length)} ${nm} kończy na ${st.finished.length}. miejscu!`, "win");
    } else if (hand.length === 1) { if (!st.uno[pid]) st.vuln = pid; } else st.uno[pid] = false;
    if (card.v === P3) {
      if (st.opts.stack) {
        st.pending += 3;
        advance(st);
        log(st, `😱 ${nameIn(room, cur(st))}: przebij +3 albo dobierz ${st.pending}!`, "hit");
      } else {
        advance(st);
        const victim = cur(st);
        const n = give(st, victim, 3);
        log(st, `😱 ${nameIn(room, victim)} dobiera ${n} i traci turę`, "hit");
        advance(st);
      }
    } else advance(st);
    if (out) {
      leaveSeats(st, pid);
      if (st.seats.length < 2) endGame(st, room);
    }
  }

  function draw(st, pid, room) {
    if (pid !== cur(st)) return "Poczekaj na swoją turę ⏳";
    closeCatch(st, pid);
    const nm = nameIn(room, pid);
    if (st.pending > 0) {
      const n = give(st, pid, st.pending);
      log(st, `${nm} dobiera ${n} ${n === 1 ? "kartę" : cardsWord(n)} 🩸`, "hit");
      st.pending = 0;
      advance(st);
      return;
    }
    if (st.drew != null) return "Masz już dobraną kartę – zagraj ją albo spasuj.";
    const c = draw1(st);
    if (!c) { log(st, `${nm} – talia pusta, tura przechodzi dalej`); advance(st); return; }
    st.hands[pid].push(c);
    st.uno[pid] = false;
    if (canPlay(st, c, top(st), 0)) { st.drew = c.id; log(st, `${nm} dobiera kartę`); }
    else { log(st, `${nm} dobiera kartę i pasuje`); advance(st); }
  }

  function action(st, pid, m, room) {
    const host = pid === room.hostId;
    const x = m.x, y = m.y;
    let err;
    switch (m.a) {
      case "color": {
        if (st.phase !== "setup") return;
        const k = parseInt(x, 10);
        if (!COLORS[k]) return;
        const owner = Object.keys(st.colors).find(p => st.colors[p] === k && room.players.some(q => q.id === p));
        if (owner && owner !== pid) return "Ten kolor jest już zajęty 🕸️";
        if (st.colors[pid] === k) delete st.colors[pid]; else st.colors[pid] = k;
        break;
      }
      case "opt":
        if (!host || st.phase !== "setup") return;
        if (x === "hand" && [5, 7, 9].includes(+y)) st.opts.hand = +y;
        if (x === "stack" || x === "pairs") st.opts[x] = y === true || y === "1";
        break;
      case "pair": {
        if (!host || st.phase !== "setup") return;
        const [r, c] = String(x).split("-").map(Number);
        if (!st.pairs[r] || (c !== 0 && c !== 1)) return;
        if (y && !room.players.some(p => p.id === y)) return;
        st.pairs[r][c] = y || "";
        break;
      }
      case "start":
        if (!host || st.phase === "play") return;
        err = start(st, room);
        break;
      case "setup":
        if (!host) return;
        st.phase = "setup";
        break;
      case "play":
        if (st.phase !== "play") return;
        err = play(st, pid, parseInt(x, 10), room);
        break;
      case "draw":
        if (st.phase !== "play") return;
        err = draw(st, pid, room);
        break;
      case "pass":
        if (st.phase !== "play" || pid !== cur(st) || st.drew == null) return;
        log(st, `${nameIn(room, pid)} pasuje`);
        advance(st);
        break;
      case "uno": {
        if (st.phase !== "play" || !st.hands[pid]) return;
        if (st.hands[pid].length > 2) return "UNO krzyczy się przy ostatniej karcie 😉";
        if (st.uno[pid]) return;
        st.uno[pid] = true;
        if (st.vuln === pid) st.vuln = null;
        st.shout = { pid, n: st.seq };
        log(st, `📣 ${nameIn(room, pid)} krzyczy UNO!`, "uno");
        break;
      }
      case "catch":
        if (st.phase !== "play" || !st.hands[pid] || x === pid) return;
        if (st.vuln !== x) return "Za późno – już bezpieczny 😅";
        give(st, x, 2);
        st.vuln = null;
        log(st, `🪤 ${nameIn(room, x)} bez UNO – łapie ${nameIn(room, pid)}! +2`, "hit");
        break;
      case "skip":
        if (!host || st.phase !== "play") return;
        {
          const who = cur(st);
          if (st.pending > 0) { give(st, who, st.pending); st.pending = 0; }
          log(st, `⏭️ Host pomija turę: ${nameIn(room, who)}`);
          advance(st);
        }
        break;
      default: return;
    }
    tidy(st);
    return err;
  }

  function playerLeft(st, pid, room) {
    delete st.colors[pid];
    st.pairs.forEach(p => { if (p[0] === pid) p[0] = ""; if (p[1] === pid) p[1] = ""; });
    const i = st.seats.indexOf(pid);
    if (st.phase !== "play" || i < 0) return;
    const wasTurn = i === st.turn;
    st.deck = shuffle(st.deck.concat(st.hands[pid]));
    delete st.hands[pid];
    st.seats.splice(i, 1);
    if (i < st.turn) st.turn--;
    if (st.turn >= st.seats.length) st.turn = 0;
    if (wasTurn) { st.drew = null; }
    if (st.vuln === pid) st.vuln = null;
    log(st, `👋 ${nameIn(room, pid)} opuszcza grę`);
    if (st.seats.length < 2) endGame(st, room);
  }

  function view(st, pid) {
    const counts = {};
    for (const p of st.seats) counts[p] = (st.hands[p] || []).length;
    const d = st.discard;
    return {
      phase: st.phase, opts: st.opts, pairs: st.pairs, colors: st.colors, seats: st.seats, counts,
      hand: st.hands[pid] || null,
      top: d.length ? d[d.length - 1] : null,
      under: d.slice(-4, -1).map(x => x.card),
      deck: st.deck.length, turn: cur(st), pending: st.pending,
      drew: pid === cur(st) ? st.drew : null,
      uno: st.uno, vuln: st.vuln, log: st.log.slice(-8), winner: st.winner, ranking: st.ranking,
      finished: st.finished || [], done: st.done, loser: st.loser,
      shout: st.shout, last: st.last, round: st.round,
    };
  }

  // ─────────── Widok (u każdego) ───────────
  const ownerOf = (v, k) => Object.keys(v.colors).find(p => v.colors[p] === k && player(p));
  function cardHTML(c, cls = "") {
    const col = COLORS[c.k] || COLORS[0];
    const l = label(c);
    const u = c.v === 6 || c.v === 9 ? " u" : "";
    return `<span class="ucard ${c.v === P3 ? "p3" : ""} ${cls}" style="--c:${col.hex}">
      <i class="cn tl${u}">${l}</i><i class="cn br${u}">${l}</i>
      <span class="oval"><span class="face pk-${c.k}"><em>${col.emoji}</em></span></span>
      <b class="big${u}">${l}</b></span>`;
  }
  const backHTML = (cls = "") => `<span class="ucard back ${cls}"><span class="oval"><b>UNO</b><em>🎃</em></span></span>`;
  const swatchStyle = k => `--c:${(COLORS[k] || COLORS[0]).hex}`;

  function render(v) {
    if (v.phase === "setup") return setupHTML(v);
    return tableHTML(v) + (v.phase === "over" ? overHTML(v) : "");
  }

  function setupHTML(v) {
    const mine = v.colors[me()];
    const host = isHost();
    const list = players();
    const ready = list.filter(p => v.colors[p.id] != null);
    const sel = (r, c) => {
      const val = v.pairs[r][c];
      if (!host) return `<span class="pair-name">${val && player(val) ? avatar(val, "xs") + esc(pName(val)) : "—"}</span>`;
      return `<select data-chg="pair" data-x="${r}-${c}"><option value="">— wybierz —</option>${list.map(p => `<option value="${esc(p.id)}" ${p.id === val ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
    };
    return `
    <section class="uno-setup">
      <div class="setup-hero"><h2 class="spooky">Upiorne <span>UNO</span></h2><p>Twoja twarz · Twój kolor · Twoje karty</p></div>

      <div class="glass step">
        <h3><span class="stepnum">1</span> Twoje zdjęcie</h3>
        <div class="photo-row">
          ${avatar(me(), "xl")}
          <div class="photo-btns">
            <label class="btn orange small"><input type="file" accept="image/*" capture="user" data-photo hidden>📸 Zrób selfie</label>
            <label class="btn ghost small"><input type="file" accept="image/*" data-photo hidden>🖼️ Z galerii</label>
          </div>
        </div>
        <p class="hint">Twarz trafi na wszystkie karty w Twoim kolorze 👀</p>
      </div>

      <div class="glass step">
        <h3><span class="stepnum">2</span> Twój kolor</h3>
        <div class="swatches">
          ${COLORS.map((col, k) => {
            const owner = ownerOf(v, k);
            const cls = owner === me() ? "mine" : owner ? "taken" : "";
            return `<button class="swatch ${cls}" style="${swatchStyle(k)}" data-act="color" data-x="${k}" ${owner && owner !== me() ? "disabled" : ""}>
              ${owner ? avatar(owner, "sm") : `<span class="sw-emoji">${col.emoji}</span>`}<small>${owner ? esc(pName(owner)) : col.name}</small></button>`;
          }).join("")}
        </div>
        ${mine != null ? `<div class="preview-cards">${cardHTML({ k: mine, v: 7 }, "tilt-l")}${cardHTML({ k: mine, v: P3 }, "tilt-r")}</div>` : `<p class="hint">Dotknij koloru, żeby go zająć.</p>`}
      </div>

      <div class="glass">
        <h3>Gotowi <span class="count">${ready.length}/${list.length}</span></h3>
        <ul class="plist compact">
          ${list.map(p => `<li class="${p.online ? "" : "off"}">${avatar(p.id, "sm")}<span class="pn">${esc(p.name)}</span>
            ${v.colors[p.id] != null ? `<span class="dot" style="${swatchStyle(v.colors[p.id])}"></span>` : '<span class="tag dim">wybiera…</span>'}
            ${S.photos[p.id] ? "" : '<span class="tag dim">bez zdjęcia</span>'}</li>`).join("")}
        </ul>
      </div>

      <div class="glass settings">
        <h3>Zasady ${host ? "" : '<span class="tag dim">ustawia host</span>'}</h3>
        <div class="set-row"><span>Karty na start</span>
          <div class="seg">${[5, 7, 9].map(n => `<button class="${v.opts.hand === n ? "on" : ""}" ${host ? `data-act="opt" data-x="hand" data-y="${n}"` : "disabled"}>${n}</button>`).join("")}</div></div>
        <div class="set-row"><span>Przebijanie +3 kolejną +3<small>kary się sumują</small></span>${toggle("stack", v.opts.stack, host)}</div>
        <div class="set-row"><span>Pary 💞<small>kolor osoby z pary można położyć na kolor drugiej – jedna karta na raz</small></span>${toggle("pairs", v.opts.pairs, host)}</div>
        ${v.opts.pairs ? `<div class="pairs">${[0, 1].map(r => `<div class="pair-row"><b>${r + 1}.</b>${sel(r, 0)}<span class="heart">💞</span>${sel(r, 1)}</div>`).join("")}</div>` : ""}
        <details class="rules"><summary>Jak się gra?</summary>
          <ul>
            <li>Kładziesz kartę w tym samym <b>kolorze</b> albo z tą samą <b>liczbą</b>.</li>
            <li><b>+3</b> – następna osoba dobiera 3 karty i traci turę${v.opts.stack ? " (chyba że przebije własną +3)" : ""}.</li>
            <li>Nie masz co położyć? Dobierz kartę – jeśli pasuje, możesz ją od razu zagrać.</li>
            <li>Przy przedostatniej karcie krzycz <b>UNO!</b> – kto się zapomni, może zostać złapany (+2).</li>
            <li>Kto pozbędzie się kart, zajmuje miejsce (🥇, 🥈, 🥉…), a reszta gra dalej – aż zostanie jedna osoba z kartami 👻.</li>
          </ul>
        </details>
        ${host ? `<button class="btn orange big" data-act="start" ${ready.length < 2 ? "disabled" : ""}>🎃 Rozdaj karty</button>
          ${ready.length < 2 ? '<p class="hint">Potrzeba min. 2 graczy z kolorem.</p>' : ready.length < list.length ? '<p class="hint">Gracze bez koloru tylko oglądają tę rundę.</p>' : ""}`
          : `<p class="hint wait">⏳ Host rozda karty, gdy wszyscy będą gotowi…</p>`}
      </div>
    </section>`;
  }

  const toggle = (key, on, host) => `<button class="toggle ${on ? "on" : ""}" ${host ? `data-act="opt" data-x="${key}" data-y="${on ? "0" : "1"}"` : "disabled"} aria-pressed="${on}"><i></i></button>`;

  // Pamięć animacji – co już widzieliśmy na tym urządzeniu.
  const seen = { top: null, hand: new Set(), round: null };

  function tableHTML(v) {
    const meId = me();
    const hand = v.hand;
    const myTurn = v.phase === "play" && v.turn === meId;
    const order = v.seats.slice();
    const mi = order.indexOf(meId);
    const opps = mi >= 0 ? order.slice(mi + 1).concat(order.slice(0, mi)) : order;
    if (seen.round !== v.round) { seen.round = v.round; seen.hand = new Set(); seen.top = null; }

    const topEntry = v.top;
    const topN = v.last ? v.last.n : 0;
    const fresh = topN && seen.top !== topN;
    const flyFrom = topEntry && topEntry.by === meId ? "from-me" : "from-top";
    seen.top = topN;

    const playable = c => myTurn && (v.drew == null || v.drew === c.id) && canPlay(v, c, topEntry && topEntry.card, v.pending);
    const newIds = hand ? hand.filter(c => !seen.hand.has(c.id)).map(c => c.id) : [];
    const firstDeal = hand && seen.hand.size === 0;
    if (hand) seen.hand = new Set(hand.map(c => c.id));

    const opChip = pid => {
      const p = player(pid);
      const n = v.counts[pid];
      const col = v.colors[pid];
      return `<div class="opp ${v.turn === pid && v.phase === "play" ? "turn" : ""} ${p && !p.online ? "off" : ""}" style="${swatchStyle(col)}">
        <div class="opp-av">${avatar(pid)}${v.uno[pid] && n === 1 ? '<span class="uno-tag">UNO</span>' : ""}</div>
        <span class="opp-name">${esc(pName(pid))}</span>
        <span class="opp-count"><i class="mini-back"></i>${n}</span>
        ${v.vuln === pid && hand ? `<button class="btn danger tiny catch" data-act="catch" data-x="${esc(pid)}">Złap! 🪤</button>` : ""}
      </div>`;
    };

    const fin = v.finished || [];
    const myPlace = fin.indexOf(meId) + 1;
    const podium = fin.length ? `<div class="podium">${fin.map((p, i) => `<span class="pod">${medal(i + 1)}${avatar(p, "xs")}<b>${esc(pName(p))}</b></span>`).join("")}</div>` : "";

    const pairTags = v.opts.pairs ? v.pairs.filter(([a, b]) => a && b && player(a) && player(b))
      .map(([a, b]) => `<span class="pair-tag">${avatar(a, "xs")}💞${avatar(b, "xs")}</span>`).join("") : "";

    const turnTxt = v.phase !== "play" ? "Koniec rundy"
      : myTurn ? (v.pending ? `Twoja tura – przebij albo dobierz ${v.pending}!` : v.drew != null ? "Zagraj dobraną kartę albo spasuj" : "Twoja tura!")
      : `Tura: ${avatar(v.turn, "xs")} <b>${esc(pName(v.turn))}</b>`;

    let actions = "";
    if (hand) {
      if (myTurn && v.pending) actions += `<button class="btn danger" data-act="draw">Dobierz ${v.pending} 🩸</button>`;
      else if (myTurn && v.drew != null) actions += `<button class="btn ghost" data-act="pass">Pas ✋</button>`;
      else if (myTurn) actions += `<button class="btn ghost" data-act="draw">Dobierz kartę</button>`;
      if (hand.length <= 2 && hand.length > 0 && !v.uno[meId] && v.phase === "play")
        actions += `<button class="btn uno-btn ${v.vuln === meId ? "urgent" : ""}" data-act="uno">UNO!</button>`;
      else if (v.uno[meId] && hand.length === 1) actions += `<span class="safe-tag">📣 UNO zgłoszone</span>`;
    }

    return `
    <section class="uno-table fit-screen ${myTurn ? "my-turn" : ""}">
      <div class="opps" data-keep="opps">${opps.map(opChip).join("") || '<p class="hint">Brak przeciwników</p>'}</div>
      ${myPlace ? `<div class="won-bar"><span class="wb-medal">${medal(myPlace)}</span><span><b>${myPlace}. miejsce!</b> Nie masz już kart – patrz, jak grają inni 👀</span></div>` : ""}

      <div class="tablecloth">
        ${podium}
        <div class="turn-banner ${myTurn ? "mine" : ""}">${turnTxt}</div>
        <div class="piles">
          <button class="deck" data-act="draw" ${myTurn && v.drew == null ? "" : "disabled"} aria-label="Dobierz kartę">
            ${backHTML("d3")}${backHTML("d2")}${backHTML("d1")}<span class="deck-n">${v.deck}</span>
          </button>
          <div class="discard">
            ${v.under.map(c => `<span class="under-wrap" data-key="u${c.id}">${cardHTML(c, "under")}</span>`).join("")}
            ${topEntry ? `<div data-key="t${topN}" class="top-wrap ${fresh ? "fly " + flyFrom : ""}" style="--r:${(topN * 37) % 16 - 8}deg">${cardHTML(topEntry.card, "top")}
              ${topEntry.by ? `<span class="by-badge">${avatar(topEntry.by, "sm")}</span>` : ""}</div>` : ""}
            ${v.pending ? `<span class="pending">+${v.pending}</span>` : ""}
          </div>
        </div>
        <div class="laid-by">${topEntry && topEntry.by
          ? `${avatar(topEntry.by, "xs")}<span>Kładzie: <b>${esc(pName(topEntry.by))}</b></span>${topEntry.pair ? '<span class="pair-chip">💞 para</span>' : ""}`
          : "<span>Pierwsza karta z talii</span>"}</div>
        ${pairTags ? `<div class="pair-tags">${pairTags}</div>` : ""}
        <ul class="feed">${v.log.slice(-2).reverse().map((l, i) => `<li class="${l.kind} ${i ? "" : "newest"}">${esc(l.txt)}</li>`).join("")}</ul>
      </div>

      <div class="me-area">
        ${myPlace || !hand ? liveHTML(v, myPlace) : `
          <div class="actions">${actions}</div>
          <div class="hand ${myTurn ? "active" : ""}" data-keep="hand">
            ${hand.map((c, i) => {
              const ok = playable(c);
              const isNew = newIds.includes(c.id);
              return `<button data-key="c${c.id}" class="hcard ${ok ? "ok" : myTurn ? "no" : ""} ${isNew ? "deal" : ""} ${v.drew === c.id ? "drawn" : ""}"
                style="--i:${firstDeal ? i : 0}" data-act="play" data-x="${c.id}" ${ok ? "" : 'aria-disabled="true"'}>${cardHTML(c)}</button>`;
            }).join("")}
          </div>
          <div class="my-count">${avatar(meId, "xs")} Masz <b>${hand.length}</b> ${hand.length === 1 ? "kartę" : cardsWord(hand.length)}</div>`}
      </div>
    </section>`;
  }

  // Dla tych, którzy skończyli albo tylko oglądają: kto co kładzie, na żywo.
  function liveHTML(v, myPlace) {
    const items = v.log.slice().reverse().map(l => l.kind === "play" && l.card
      ? `<li class="lv play" data-key="l${l.n}">${cardHTML(l.card, "mini")}${avatar(l.by, "xs")}<span><b>${esc(pName(l.by))}</b> kładzie ${label(l.card)}${l.pair ? " 💞" : ""}</span></li>`
      : `<li class="lv ${l.kind}" data-key="l${l.n}"><span>${esc(l.txt)}</span></li>`).join("");
    return `<div class="watch">
      <h4><i class="live-dot"></i> Na żywo</h4>
      <ul class="live">${items}</ul>
      ${myPlace ? "" : '<p class="hint">👀 Oglądasz tę rundę – dołączysz w następnej.</p>'}
    </div>`;
  }

  function overHTML(v) {
    const w = v.winner;
    return `<div class="over-veil"><div class="glass over">
      <div class="crown">👑</div>
      ${avatar(w, "xxl")}
      <h2 class="spooky">${esc(pName(w))}<br><span>wygrywa!</span></h2>
      ${v.loser && v.loser !== w ? `<p class="loser">👻 <b>${esc(pName(v.loser))}</b> zostaje z kartami</p>` : ""}
      <ol class="ranking">${(v.ranking || []).map((r, i) => {
        const last = r.pid === v.loser && r.pid !== w;
        return `<li class="${last ? "last" : ""}">${last ? "👻" : medal(i + 1)} <i class="place">${i + 1}.</i> ${avatar(r.pid, "xs")} <span>${esc(pName(r.pid))}</span><b>${r.n ? `${r.n} ${cardsWord(r.n)}` : "🎉"}</b></li>`;
      }).join("")}</ol>
      ${isHost() ? `<div class="over-btns"><button class="btn orange" data-act="start">🔁 Rewanż</button><button class="btn ghost" data-act="setup">⚙️ Zmień zasady</button><button class="btn ghost small" data-act="room.lobby">🏚️ Lobby</button></div>`
        : `<p class="hint wait">⏳ Host zdecyduje, co dalej…</p>`}
    </div></div>`;
  }

  // Karty w ręce dobierają rozmiar tak, żeby wszystkie zmieściły się w ~1/3 ekranu.
  function layout(root) {
    const hand = root.querySelector(".hand");
    if (!hand) return;
    const n = hand.children.length;
    const W = hand.clientWidth - 8;
    const H = Math.max(96, window.innerHeight * (window.innerHeight < 720 ? 0.25 : 0.3));
    let w = 34;
    for (let t = 84; t >= 34; t -= 2) {
      const cols = Math.max(1, Math.floor((W + 4) / (t + 4)));
      if (Math.ceil(n / cols) * (t * 1.48 + 6) + 14 <= H) { w = t; break; }
    }
    hand.style.setProperty("--hw", w + "px");
  }

  function photoMap(v) {
    const map = {};
    for (const [pid, k] of Object.entries(v.colors)) if (player(pid)) map["pk-" + k] = pid;
    return map;
  }

  function hostMenu(v) {
    const items = [];
    if (v.phase === "play") items.push({ label: `⏭️ Pomiń turę: ${esc(pName(v.turn))}`, act: "skip" });
    if (v.phase !== "setup") items.push({ label: "⚙️ Przerwij i wróć do zasad", act: "setup" });
    return items;
  }

  function effects(prev, v) {
    if (!v) return;
    const meId = me();
    if (v.phase === "play" && v.turn === meId && (!prev || prev.turn !== meId || prev.phase !== "play")) buzz(60);
    if (v.shout && (!prev || !prev.shout || prev.shout.n !== v.shout.n)) shoutFX(v.shout.pid);
    if (v.done && v.phase === "play" && (!prev || !prev.done || prev.done.n !== v.done.n)) finishFX(v.done.pid, v.done.place);
    if (v.phase === "over" && (!prev || prev.phase !== "over")) { candyFX(); buzz([80, 60, 120]); }
    const lastLog = v.log[v.log.length - 1];
    if (prev && lastLog && lastLog.kind === "hit" && (!prev.log.length || prev.log[prev.log.length - 1].n !== lastLog.n)) {
      document.body.classList.remove("shake"); void document.body.offsetWidth; document.body.classList.add("shake");
    }
  }

  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

  function shoutFX(pid) {
    const fx = document.getElementById("fx");
    const el = document.createElement("div");
    el.className = "shout";
    el.innerHTML = `${avatar(pid, "xl")}<b>UNO!</b><small>${esc(pName(pid))}</small>`;
    fx.appendChild(el);
    buzz(120);
    setTimeout(() => el.remove(), 1800);
  }

  function finishFX(pid, place) {
    const fx = document.getElementById("fx");
    const el = document.createElement("div");
    el.className = "shout fin";
    el.innerHTML = `${avatar(pid, "xl")}<b>${medal(place)} ${place}.</b><small>${esc(pName(pid))} kończy!</small>`;
    fx.appendChild(el);
    if (pid === me()) { candyFX(); buzz([60, 40, 60]); }
    setTimeout(() => el.remove(), 2200);
  }

  function candyFX() {
    const fx = document.getElementById("fx");
    const bits = ["🍬", "🎃", "🦇", "🍭", "👻", "🕷️", "🍫", "⭐"];
    for (let i = 0; i < 40; i++) {
      const s = document.createElement("span");
      s.className = "candy";
      s.textContent = bits[i % bits.length];
      s.style.left = Math.random() * 100 + "vw";
      s.style.setProperty("--d", (2.2 + Math.random() * 2.4).toFixed(2) + "s");
      s.style.setProperty("--x", (Math.random() * 120 - 60).toFixed(0) + "px");
      s.style.setProperty("--r", (Math.random() * 720 - 360).toFixed(0) + "deg");
      s.style.animationDelay = (Math.random() * 0.9).toFixed(2) + "s";
      fx.appendChild(s);
      setTimeout(() => s.remove(), 5600);
    }
  }

  registerGame({
    id: "uno", name: "Upiorne UNO", emoji: "🃏", tagline: "UNO z Waszymi twarzami – każdy gracz to osobny kolor, a zamiast +2/+4 jest +3.",
    min: 2, max: 10,
    create, action, view, render, playerLeft, photoMap, hostMenu, effects, layout,
  });
})();
