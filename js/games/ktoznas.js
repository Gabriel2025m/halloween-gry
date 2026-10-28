"use strict";
// ═════════════ Kto z nas? ═════════════
// Pytanie dla całej ekipy („Kto z nas pierwszy uciekłby z nawiedzonego domu?”), każdy głosuje na kogoś z pokoju.
// Po odsłonięciu wyników punkt dostają ci, którzy wskazali osobę z największą liczbą głosów.
// Na koniec każdy „zwycięzca” pytania dostaje swój tytuł wieczoru.
(() => {
  const QUESTIONS = [
    "Kto z nas pierwszy uciekłby z nawiedzonego domu?",
    "Kto zasnąłby w połowie horroru?",
    "Kto przebrałby się za coś, czego nikt nie rozpozna?",
    "Kto zjadłby wszystkie cukierki, zanim przyjdą goście?",
    "Kto krzyczy najgłośniej, kiedy coś wyskoczy?",
    "Kto byłby najlepszym wampirem?",
    "Kto przeżyłby apokalipsę zombie najdłużej?",
    "Kto zgubiłby się w kukurydzianym labiryncie?",
    "Kto rozmawiałby z duchem, jakby nigdy nic?",
    "Kto wydrążyłby najbrzydszą dynię?",
    "Kto udawałby, że się nie boi, a w środku umiera ze strachu?",
    "Kto byłby najstraszniejszą czarownicą?",
    "Kto poszedłby sam w nocy do piwnicy „bo coś słyszał”?",
    "Kto wymyśliłby najlepszą historię o duchach?",
    "Kto spóźniłby się na własną imprezę halloweenową?",
    "Kto zrobiłby najlepszy kostium za 0 zł?",
    "Kto pierwszy dałby się zjeść w horrorze?",
    "Kto zostałby przyjacielem potwora spod łóżka?",
    "Kto najczęściej mówi „to tylko wiatr”?",
    "Kto wygrałby konkurs na najstraszniejszą minę?",
    "Kto przyniósłby na imprezę najdziwniejsze jedzenie?",
    "Kto po filmie grozy śpi przy zapalonym świetle?",
    "Kto byłby królem lub królową balu potworów?",
    "Kto najlepiej udaje zombie?",
    "Kto zadzwoniłby do łowców duchów przy pierwszym skrzypnięciu?",
    "Kto zjadłby podejrzany grzyb z lasu „bo ładnie wyglądał”?",
    "Kto przestraszyłby innych najlepiej, chowając się za drzwiami?",
    "Kto zrobiłby selfie z duchem zamiast uciekać?",
    "Kto byłby najbardziej uroczym potworem?",
    "Kto zorganizowałby najlepszą imprezę Halloween?",
    "Kto pomyliłby czarnego kota z kapciem?",
    "Kto przekonałby wampira, żeby został wegetarianinem?",
  ];
  const ROUNDS = [5, 8, 12];
  const nameIn = (room, pid) => (room.players.find(p => p.id === pid) || {}).name || "Ktoś";
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ─────────── Silnik (u hosta) ───────────
  function create(room, prev) {
    return { phase: "setup", opts: prev ? prev.opts : { rounds: 8 }, round: 0, seats: [], scores: {}, votes: {}, deck: [], q: "", last: null, history: [], seq: 1 };
  }

  function start(st, room) {
    const seats = room.players.filter(p => p.online).map(p => p.id);
    if (seats.length < 3) return "Potrzeba co najmniej 3 graczy.";
    Object.assign(st, { seats, scores: {}, round: 0, deck: shuffle(QUESTIONS.slice()), history: [], last: null });
    for (const p of seats) st.scores[p] = 0;
    next(st);
  }

  function next(st) {
    if (st.round >= st.opts.rounds || st.round >= st.deck.length) { st.phase = "over"; return; }
    st.q = st.deck[st.round++];
    st.votes = {};
    st.phase = "vote";
  }

  function reveal(st) {
    const counts = {};
    for (const t of Object.values(st.votes)) counts[t] = (counts[t] || 0) + 1;
    const max = Math.max(0, ...Object.values(counts));
    const winners = max ? Object.keys(counts).filter(t => counts[t] === max) : [];
    const good = Object.keys(st.votes).filter(p => winners.includes(st.votes[p]));
    for (const p of good) st.scores[p] = (st.scores[p] || 0) + 1;
    st.last = { n: st.seq++, q: st.q, votes: { ...st.votes }, counts, winners, good };
    if (winners.length) st.history.push({ q: st.q, winners });
    st.phase = "reveal";
  }

  function action(st, pid, m, room) {
    const host = pid === room.hostId;
    switch (m.a) {
      case "opt":
        if (host && st.phase === "setup" && m.x === "rounds" && ROUNDS.includes(+m.y)) st.opts.rounds = +m.y;
        return;
      case "start":
        if (!host || st.phase === "vote" || st.phase === "reveal") return;
        return start(st, room);
      case "setup":
        if (host) st.phase = "setup";
        return;
      case "vote":
        if (st.phase !== "vote" || !st.seats.includes(pid) || !st.seats.includes(m.x)) return;
        if (m.x === pid) return "Na siebie nie można 😉";
        st.votes[pid] = m.x;
        if (st.seats.every(p => st.votes[p])) reveal(st);
        return;
      case "reveal":
        if (host && st.phase === "vote" && Object.keys(st.votes).length) reveal(st);
        return;
      case "next":
        if (host && st.phase === "reveal") next(st);
        return;
    }
  }

  function playerLeft(st, pid) {
    st.seats = st.seats.filter(p => p !== pid);
    delete st.votes[pid];
    for (const p of Object.keys(st.votes)) if (st.votes[p] === pid) delete st.votes[p];
    if (st.phase === "vote" && st.seats.length && st.seats.every(p => st.votes[p])) reveal(st);
  }

  function view(st, pid) {
    return {
      phase: st.phase, opts: st.opts, round: st.round, seats: st.seats, scores: st.scores, q: st.q,
      voted: Object.keys(st.votes), myVote: st.votes[pid] || null, last: st.last, history: st.history,
    };
  }

  // ─────────── Widok (u każdego) ───────────
  function render(v) {
    if (v.phase === "setup") return setupHTML(v);
    return playHTML(v) + (v.phase === "over" ? overHTML(v) : "");
  }

  function setupHTML(v) {
    const host = isHost();
    const online = players().filter(p => p.online);
    const rules = [
      "❓ Na ekranie pojawia się pytanie, np. „Kto z nas pierwszy uciekłby z nawiedzonego domu?”.",
      "👆 Każdy dotyka zdjęcia osoby, która jego zdaniem najbardziej pasuje (na siebie nie można).",
      "📊 Gdy wszyscy zagłosują, wyniki się odsłaniają – widać, kto na kogo głosował.",
      "⭐ Punkt dostaje każdy, kto wskazał osobę z największą liczbą głosów (trafił w zdanie ekipy).",
      "👑 Na koniec każdy, kto „wygrał” pytanie, dostaje swój tytuł wieczoru.",
    ];
    return `
    <section class="gm-setup fit-screen"><div class="fit-inner">
      <div class="setup-head"><h2 class="spooky">Kto <span class="kz-purple">z nas?</span></h2>${rulesButton()}</div>
      <div class="glass kz-demo"><b>„Kto z nas pierwszy uciekłby z nawiedzonego domu?”</b><p>Głosujcie na siebie nawzajem – zdjęcia bardzo pomagają 😄</p></div>
      <div class="glass"><div class="me-row">${avatar(me(), "xl")}<div class="me-info"><b>${esc(pName(me()))}</b>${photoButtons()}</div></div></div>
      <div class="glass settings compact">
        <div class="ready-row">${online.map(p => `<span class="rp" title="${esc(p.name)}">${avatar(p.id, "sm")}</span>`).join("")}<span class="lbl">Graczy: ${online.length}</span></div>
        <div class="set-row"><span>Liczba pytań</span>
          <div class="seg">${ROUNDS.map(n => `<button class="${v.opts.rounds === n ? "on" : ""}" ${host ? `data-act="opt" data-x="rounds" data-y="${n}"` : "disabled"}>${n}</button>`).join("")}</div></div>
        ${host ? `<button class="btn orange big" data-act="start" ${online.length < 3 ? "disabled" : ""}>👻 Zaczynamy</button>
          ${online.length < 3 ? '<p class="hint">Potrzeba min. 3 graczy.</p>' : ""}` : `<p class="hint wait">⏳ Host zaraz zacznie…</p>`}
      </div>
    </div></section>${rulesModal("Jak grać w „Kto z nas?”", rules)}`;
  }

  function playHTML(v) {
    const meId = me();
    const playing = v.seats.includes(meId);
    const chips = v.seats.slice().sort((a, b) => v.scores[b] - v.scores[a]).map((p, i) => `
      <div class="gm-chip ${v.phase === "vote" && v.voted.includes(p) ? "turn" : ""}">${avatar(p, "sm")}<div><b>${esc(pName(p))}</b><small>${v.scores[p]} pkt${v.phase === "vote" ? (v.voted.includes(p) ? " · ✅" : " · 🤔") : ""}</small></div>${i === 0 && v.scores[p] > 0 ? '<span class="lead">👑</span>' : ""}</div>`).join("");
    let body;
    if (v.phase === "vote") {
      body = `
        <div class="kz-q" data-key="q${v.round}"><small>Pytanie ${v.round} / ${v.opts.rounds}</small><h2>${esc(v.q)}</h2></div>
        <div class="kz-grid n${Math.min(v.seats.length, 10)}">
          ${v.seats.map(p => `<button class="kz-pick ${v.myVote === p ? "picked" : ""} ${p === meId ? "self" : ""}" ${playing && p !== meId ? `data-act="vote" data-x="${esc(p)}"` : "disabled"}>
            ${avatar(p, "xl")}<span>${esc(pName(p))}</span>${v.myVote === p ? '<i class="kz-check">✓</i>' : ""}</button>`).join("")}
        </div>
        <div class="kz-foot">${playing ? (v.myVote ? "Głos oddany – możesz go jeszcze zmienić" : "Dotknij zdjęcia osoby") : "👀 Oglądasz – dołączysz w następnej grze"} · zagłosowało ${v.voted.length}/${v.seats.length}
          ${isHost() && v.voted.length && v.voted.length < v.seats.length ? '<button class="btn ghost small" data-act="reveal">Pokaż wyniki</button>' : ""}</div>`;
    } else if (v.last) {
      const L = v.last;
      const rows = Object.keys(L.counts).sort((a, b) => L.counts[b] - L.counts[a]);
      const max = L.counts[rows[0]] || 1;
      body = `
        <div class="kz-q"><small>Pytanie ${v.round} / ${v.opts.rounds}</small><h2>${esc(L.q)}</h2></div>
        <div class="kz-reveal">
          ${rows.map(t => `<div class="kz-bar ${L.winners.includes(t) ? "win" : ""}" data-key="b${L.n}-${esc(t)}">
            ${avatar(t, "sm")}<div class="kz-barwrap"><div class="kz-fill" style="--w:${(L.counts[t] / max) * 100}%"><b>${esc(pName(t))}</b>${L.winners.includes(t) ? " 👑" : ""}</div>
            <div class="kz-voters">${Object.keys(L.votes).filter(p => L.votes[p] === t).map(p => avatar(p, "xs")).join("")}</div></div>
            <em>${L.counts[t]}</em></div>`).join("")}
        </div>
        <div class="kz-foot">${L.good.includes(meId) ? "⭐ Trafiłeś w zdanie ekipy: +1" : playing ? "Tym razem bez punktu" : ""}
          ${isHost() && v.phase === "reveal" ? `<button class="btn orange" data-act="next">${v.round >= v.opts.rounds ? "🏆 Podsumowanie" : "➡️ Następne pytanie"}</button>` : v.phase === "reveal" ? '<span class="hint">Host zaraz da następne pytanie…</span>' : ""}</div>`;
    } else body = "";
    return `
    <section class="kz-table fit-screen">
      <div class="gm-chips" data-keep="kzchips">${chips}</div>
      ${body}
    </section>`;
  }

  const listNames = ids => { const n = ids.map(p => esc(pName(p))); return n.length > 1 ? n.slice(0, -1).join(", ") + " i " + n[n.length - 1] : n[0] || ""; };

  function overHTML(v) {
    const rank = v.seats.slice().sort((a, b) => v.scores[b] - v.scores[a]);
    const w = rank[0];
    const medal = i => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
    const titles = (v.history || []).map(h => `<li>${h.winners.map(p => avatar(p, "xs")).join("")}<span><b>${listNames(h.winners)}</b> – ${esc(h.q.replace(/^Kto (z nas )?/, "").replace(/\?$/, ""))}</span></li>`).join("");
    return `<div class="over-veil"><div class="glass over">
      <div class="crown">👻</div>${avatar(w, "xxl")}
      <h2 class="spooky">${esc(pName(w))}<br><span>zna ekipę najlepiej!</span></h2>
      <ol class="ranking">${rank.map((p, i) => `<li>${medal(i)} ${avatar(p, "xs")} <span>${esc(pName(p))}</span><b>${v.scores[p]} pkt</b></li>`).join("")}</ol>
      ${titles ? `<h3 class="kz-titles-h">Tytuły wieczoru</h3><ul class="kz-titles">${titles}</ul>` : ""}
      ${isHost() ? `<div class="over-btns"><button class="btn orange" data-act="start">🔁 Nowe pytania</button><button class="btn ghost" data-act="setup">⚙️ Ustawienia</button><button class="btn ghost small" data-act="room.lobby">🏚️ Lobby</button></div>`
        : `<p class="hint wait">⏳ Host zdecyduje, co dalej…</p>`}
    </div></div>`;
  }

  function hostMenu(v) {
    const items = [];
    if (v.phase === "vote") items.push({ label: "📊 Pokaż wyniki teraz", act: "reveal" });
    if (v.phase !== "setup") items.push({ label: "⚙️ Przerwij i wróć do ustawień", act: "setup" });
    return items;
  }

  function effects(prev, v) {
    if (v && v.phase === "reveal" && (!prev || prev.phase !== "reveal")) { try { navigator.vibrate && navigator.vibrate(40); } catch {} }
  }

  registerGame({
    id: "ktoznas", name: "Kto z nas?", emoji: "👻",
    tagline: "Halloweenowe pytania o Waszą ekipę – głosujecie na siebie nawzajem i zgadujecie, co myśli reszta.",
    min: 3, max: 10,
    create, action, view, render, playerLeft, hostMenu, effects,
  });
})();
