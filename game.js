"use strict";

/* =========================================================================
   Settings you might want to change
   ========================================================================= */
const MAX_GUESSES = 10;          // number of spell slots
const CLUE_AFTER = 4;            // guesses before the clue unlocks
const LAUNCH = [2026, 8, 25];    // puzzle #1 date: [year, month (0 = Jan), day]
const SHUFFLE_SEED = 5051;       // changing this changes every future answer
const STORE_KEY = "5espelldle:v2";

/* Game modes. Each has its own spell pool, daily answer, progress and stats.
   Add a mode by adding a line; the filter decides which spells are in it. */
const MODES = [
  { id: "easy",   label: "Easy",        hint: "Cantrips and 1st level",   filter: s => s.level <= 1 },
  { id: "medium", label: "Medium",      hint: "Up to 3rd level",          filter: s => s.level <= 3 },
  { id: "hard",   label: "Hard",        hint: "Up to 5th level",          filter: s => s.level <= 5 },
  { id: "magus",  label: "Grand Magus", hint: "Every spell, up to 9th",   filter: () => true },
  { id: "bg3",    label: "BG3",         hint: "Spells in Baldur's Gate 3", filter: s => s.bg3 },
];
const DEFAULT_MODE = "magus";

/* =========================================================================
   Columns: what each tile shows and how it is compared with the answer.
   type "exact": green or red
   type "rank":  green, or red with an arrow pointing toward the answer
   type "set":   green if identical, yellow if some overlap, red if none
   ========================================================================= */
const ordinal = n => n === 0 ? "Cantrip" : n + (["th", "st", "nd", "rd"][n] || "th");
const CLASS_ABBR = { Bard: "Brd", Cleric: "Clr", Druid: "Drd", Paladin: "Pal",
                     Ranger: "Rgr", Sorcerer: "Sor", Warlock: "Wlk", Wizard: "Wiz" };

const COLUMNS = [
  { label: "Level",         type: "rank",  show: s => ordinal(s.level), rank: s => s.level },
  { label: "School",        type: "exact", show: s => s.school },
  { label: "Casting time",  type: "rank",  show: s => s.castingTime, rank: s => s.castingRank },
  { label: "Range",         type: "rank",  show: s => s.range, rank: s => s.rangeFt },
  { label: "Components",    type: "set",   get: s => s.components, show: s => s.components.join(" ") },
  { label: "Duration",      type: "rank",  rank: s => s.durationRank,
    show: s => s.duration === "Instantaneous" ? "Instant" : s.duration },
  { label: "Conc. / Ritual",type: "set",   get: s => s.tags,
    show: s => s.tags.map(t => t === "Concentration" ? "Conc." : t).join("\n") },
  { label: "Classes",       type: "set",   get: s => s.classes,
    show: s => s.classes.map(c => CLASS_ABBR[c] || c).join(" ") },
  { label: "Damage",        type: "set",   get: s => s.damage },
  { label: "Save / Attack", type: "set",   get: s => s.save },
  { label: "Book",          type: "rank",  show: s => s.book, rank: s => s.bookRank },
];
for (const col of COLUMNS) {
  if (!col.show) col.show = s => col.get(s).join("\n");
}

function compare(col, guess, answer) {
  if (col.type === "exact") {
    return { cls: col.show(guess) === col.show(answer) ? "good" : "bad" };
  }
  if (col.type === "rank") {
    if (col.show(guess) === col.show(answer)) return { cls: "good" };
    const g = col.rank(guess), a = col.rank(answer);
    if (g === null || a === null || g === a) return { cls: "bad" };
    return { cls: "bad", arrow: a > g ? "up" : "down" };
  }
  const g = new Set(col.get(guess)), a = new Set(col.get(answer));
  const same = g.size === a.size && [...g].every(x => a.has(x));
  if (same) return { cls: "good" };
  return { cls: [...g].some(x => a.has(x)) ? "part" : "bad" };
}

/* =========================================================================
   Daily answer: every browser computes the same spell from the date, so no
   server is needed. Each mode's pool is shuffled once with a fixed seed,
   then each day takes the next spell from that order.
   ========================================================================= */
function dayIndex(date = new Date()) {
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const start = Date.UTC(LAUNCH[0], LAUNCH[1], LAUNCH[2]);
  return Math.max(0, Math.round((today - start) / 86400000));
}

function seededRandom(seed) {            // "mulberry32", a tiny repeatable RNG
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const rand = seededRandom(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const TODAY = dayIndex();
const key = n => n.toLowerCase().replace(/[^a-z]/g, "");
const LOOKUP = new Map();                 // any accepted name (incl. BG3/SRD names) -> spell
for (const s of SPELLS) {
  LOOKUP.set(key(s.name), s);
  for (const a of s.aliases) LOOKUP.set(key(a), s);
}

/* =========================================================================
   Saved progress (kept in this browser only), one slot per mode
   ========================================================================= */
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode etc. */ }
}

const store = loadStore();
store.modes ??= {};
for (const m of MODES) {
  const st = (store.modes[m.id] ??= {});
  st.stats ??= { played: 0, wins: 0, streak: 0, best: 0, lastWin: null, dist: Array(MAX_GUESSES).fill(0) };
  if (st.day !== TODAY) {
    Object.assign(st, { day: TODAY, guesses: [], clueShown: false, divineCols: [], recorded: false });
  }
  st.divineCols ??= [];   // progress saved before the divine intervention easter egg existed
}
saveStore();

/* Current mode */
let MODE, POOL, ANSWER, state;

function answerFor(mode) {
  const pool = SPELLS.filter(mode.filter);
  const seed = SHUFFLE_SEED + MODES.indexOf(mode) * 104729;
  return { pool, answer: shuffled(pool, seed)[TODAY % pool.length] };
}

const guessedSpells = () => state.guesses.map(n => LOOKUP.get(key(n))).filter(Boolean);
const isWon = () => state.guesses.includes(ANSWER.name);
const isOver = () => isWon() || state.guesses.length >= MAX_GUESSES;

/* =========================================================================
   Rendering
   ========================================================================= */
const $ = id => document.getElementById(id);
const els = {
  input: $("guess-input"), list: $("suggestions"), guessBtn: $("guess-btn"),
  clueBtn: $("clue-btn"), clue: $("clue"), rows: $("rows"), summary: $("summary-row"),
  header: $("header-row"), slots: $("slots"), slotsLabel: $("slots-label"),
  message: $("message"), result: $("result"), modes: $("modes"),
};

function cell(text, classes) {
  const td = document.createElement("td");
  td.className = classes;
  const span = document.createElement("span");
  span.textContent = text;
  span.style.whiteSpace = "pre-line";
  td.append(span);
  return td;
}

function renderModes() {
  els.modes.replaceChildren(...MODES.map(m => {
    const st = store.modes[m.id];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode";
    b.setAttribute("aria-pressed", String(m === MODE));
    const done = st.guesses.length && answerFor(m).answer.name === st.guesses.at(-1) ? " ✓"
               : st.guesses.length >= MAX_GUESSES ? " ✗" : "";
    b.innerHTML = `<span></span><small></small>`;
    b.firstChild.textContent = m.label + done;
    b.lastChild.textContent = m.hint;
    b.addEventListener("click", () => setMode(m.id));
    return b;
  }));
}

function renderHeader() {
  const th = document.createElement("th");
  th.textContent = "Spell";
  th.className = "name-col";
  th.scope = "col";
  els.header.replaceChildren(th, ...COLUMNS.map(col => {
    const h = document.createElement("th");
    h.scope = "col";
    h.textContent = col.label;
    return h;
  }));
}

function renderRow(spell, animate) {
  const tr = document.createElement("tr");
  tr.append(cell(spell.name, "tile name"));
  COLUMNS.forEach((col, i) => {
    const r = compare(col, spell, ANSWER);
    const td = cell(col.show(spell), `tile ${r.cls}${r.arrow ? " " + r.arrow : ""}`);
    if (r.arrow) {
      const dir = col.label === "Book" ? (r.arrow === "up" ? "newer" : "older")
                                       : (r.arrow === "up" ? "higher" : "lower");
      td.title = `The answer's ${col.label.toLowerCase()} is ${dir}`;
    }
    if (animate) {
      td.classList.add("reveal");
      td.style.animationDelay = `${i * 80}ms`;
    }
    tr.append(td);
  });
  els.rows.prepend(tr);            // newest guess on top
}

function renderSummary() {
  els.summary.replaceChildren(cell("Summary", "tile label"));
  const guesses = guessedSpells();
  COLUMNS.forEach((col, i) => {
    const results = guesses.map(g => [g, compare(col, g, ANSWER)]);

    if (results.some(([, r]) => r.cls === "good")) {
      els.summary.append(cell(col.show(ANSWER), "tile good"));
    } else if (state.divineCols?.includes(i)) {      // revealed by the divine intervention easter egg
      els.summary.append(cell(col.show(ANSWER), "tile blessed"));
    } else if (!guesses.length) {
      els.summary.append(cell("", "tile empty"));
    } else if (col.type === "rank" && results.some(([, r]) => r.arrow)) {
      let lo = null, hi = null;     // answer is above every "up" guess and below every "down" guess
      for (const [g, r] of results) {
        if (r.arrow === "up" && (!lo || col.rank(g) > col.rank(lo))) lo = g;
        if (r.arrow === "down" && (!hi || col.rank(g) < col.rank(hi))) hi = g;
      }
      const lines = [lo && `> ${col.show(lo)}`, hi && `< ${col.show(hi)}`].filter(Boolean);
      els.summary.append(cell(lines.join("\n"), "tile bounds"));
    } else if (results.some(([, r]) => r.cls === "part")) {
      els.summary.append(cell("", "tile part"));
    } else {
      els.summary.append(cell("", "tile bad"));
    }
  });
}

function renderSlots() {
  const left = MAX_GUESSES - state.guesses.length;
  els.slots.replaceChildren(...Array.from({ length: MAX_GUESSES }, (_, i) => {
    const d = document.createElement("div");
    d.className = "slot" + (i >= left ? " spent" : "");
    return d;
  }));
  els.slotsLabel.textContent = `${left} spell slot${left === 1 ? "" : "s"} left`;
}

function clueText() {
  if (ANSWER.clue) return ANSWER.clue;
  // Spells outside the free SRD have no description we can show, so give a name hint instead
  const words = ANSWER.name.split(/\s+/);
  return `This spell's name has ${words.length} word${words.length === 1 ? "" : "s"} and starts with "${ANSWER.name[0]}".`;
}

function renderClue() {
  const n = state.guesses.length;
  els.clue.textContent = clueText();
  els.clue.hidden = !state.clueShown;
  if (state.clueShown) {
    els.clueBtn.disabled = true;
    els.clueBtn.textContent = "Clue shown";
  } else if (n >= CLUE_AFTER) {
    els.clueBtn.disabled = false;
    els.clueBtn.textContent = "Show clue";
  } else {
    const k = CLUE_AFTER - n;
    els.clueBtn.disabled = true;
    els.clueBtn.textContent = `Clue in ${k} guess${k === 1 ? "" : "es"}`;
  }
}

function renderResult() {
  const over = isOver();
  els.input.disabled = els.guessBtn.disabled = over;
  if (!over) {
    els.result.hidden = true;
    els.input.placeholder = "Type a spell name…";
    return;
  }
  const won = isWon();
  els.result.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = won ? "Solved!" : "Out of spell slots";   // the spell card below carries the name
  const p = document.createElement("p");
  p.textContent = won
    ? `Solved in ${state.guesses.length} guess${state.guesses.length === 1 ? "" : "es"}. Try another mode, or come back at midnight.`
    : `Today's spell was ${ANSWER.name}. Try another mode, or come back at midnight.`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Copy result";
  btn.addEventListener("click", shareResult);
  const support = document.createElement("p");
  support.className = "support";
  support.innerHTML = `Enjoying 5eSpellDLE? <a href="support/" target="_blank" rel="noopener">☕ Buy me a coffee</a>`;
  els.result.append(h, p, btn, support, spellCard(ANSWER));
  els.result.hidden = false;
  els.input.placeholder = won ? "Solved – see you tomorrow" : "Come back tomorrow";
}

/* ---------- Spell card, shown once the day's game is over (win or loss) ----------
   Stats come from spells.js. Rules text exists only for SRD spells and lives in
   spell-text.js (built by tools/build_spell_text.py), loaded the first time a
   card is shown so ordinary visits don't pay for it. */
const BOOKS = {
  PHB: "Player's Handbook", SCAG: "Sword Coast Adventurer's Guide", "Xanathar's": "Xanathar's Guide to Everything",
  "Tasha's": "Tasha's Cauldron of Everything", "Fizban's": "Fizban's Treasury of Dragons",
  Strixhaven: "Strixhaven: A Curriculum of Chaos",
};
let spellTextLoad = null;
function loadSpellText() {
  spellTextLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "spell-text.js";
    s.onload = () => resolve(SPELL_TEXT);   // eslint-disable-line no-undef
    s.onerror = () => { spellTextLoad = null; reject(); };
    document.head.append(s);
  });
  return spellTextLoad;
}

const esc = t => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const inline = t => esc(t)
  .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/\*(.+?)\*/g, "<em>$1</em>");

// The SRD text is paragraphs, with the odd Markdown table ("| d10 | Behavior |")
function formatText(paras) {
  let html = "", rows = [];
  const flush = () => {
    if (!rows.length) return;
    const [head, ...body] = rows.map(r => r.replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim())));
    html += `<table><thead><tr>${head.map(c => `<th>${c}</th>`).join("")}</tr></thead>`
          + `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    rows = [];
  };
  for (const p of paras) {
    if (p.trim().startsWith("|")) { if (!/^\|[\s|:-]+\|$/.test(p.trim())) rows.push(p.trim()); continue; }
    flush();
    html += `<p>${inline(p)}</p>`;
  }
  flush();
  return html;
}

function spellCard(s) {
  const card = document.createElement("article");
  card.className = "spell-card";
  const ritual = s.tags.includes("Ritual") ? " (ritual)" : "";
  const conc = s.tags.includes("Concentration");
  const stats = [
    ["Casting Time", s.castingTime],
    ["Range", s.range],
    ["Components", s.components.join(", ")],
    ["Duration", conc ? `Concentration, up to ${s.duration.toLowerCase()}` : s.duration],
  ];
  const extras = [
    ["Classes", s.classes.join(", ")],
    s.damage.length && ["Damage", s.damage.join(", ")],
    !s.save.includes("None") && ["Save / Attack", s.save.join(", ")],
    ["Source", BOOKS[s.book] || s.book],
  ].filter(Boolean);
  card.innerHTML = `
    <header>
      <h3>${esc(s.name)}</h3>
      <p class="spell-kind">${esc(describe(s))}${ritual}</p>
    </header>
    <dl class="spell-stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <div class="spell-desc"><p class="spell-note">Loading the spell description…</p></div>
    <dl class="spell-extras">${extras.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;

  const desc = card.querySelector(".spell-desc");
  const components = card.querySelector(".spell-stats div:nth-child(3) dd");
  loadSpellText().then(text => {
    const t = text[s.name];
    if (!t) {
      desc.innerHTML = `<p class="spell-note">This spell isn't in the free System Reference Document, so its full description isn't included here. You'll find it in <em>${esc(BOOKS[s.book] || s.book)}</em>.</p>`;
      return;
    }
    if (t.material) components.textContent = `${s.components.join(", ")} (${t.material})`;
    desc.innerHTML = formatText(t.desc)
      + (t.higher ? `<p><strong><em>At Higher Levels.</em></strong> ${formatText(t.higher).replace(/^<p>|<\/p>$/g, "")}</p>` : "")
      + `<p class="spell-credit">Spell text from the SRD 5.1, CC BY 4.0.</p>`;
  }).catch(() => {
    desc.innerHTML = `<p class="spell-note">Couldn't load the spell description.</p>`;
  });
  return card;
}

function renderAll() {
  $("puzzle-no").textContent = `#${TODAY + 1}`;
  $("spell-count").textContent = POOL.length;
  els.rows.replaceChildren();
  guessedSpells().forEach(s => renderRow(s, false));
  renderModes();
  renderSummary();
  renderSlots();
  renderClue();
  renderResult();
}

function setMode(id) {
  MODE = MODES.find(m => m.id === id) || MODES.find(m => m.id === DEFAULT_MODE);
  ({ pool: POOL, answer: ANSWER } = answerFor(MODE));
  state = store.modes[MODE.id];
  store.lastMode = MODE.id;
  saveStore();
  if (location.hash.slice(1) !== MODE.id) history.replaceState(null, "", "#" + MODE.id);
  say("");
  els.input.value = "";
  closeList();
  renderAll();
}

/* =========================================================================
   Guessing
   ========================================================================= */
function say(text) {
  els.message.textContent = text;
}

function submitGuess(name) {
  if (isOver()) return;
  const spell = LOOKUP.get(key(name));
  if (!spell || !MODE.filter(spell)) {
    say(spell ? `${spell.name} isn't in ${MODE.label} mode (${MODE.hint.toLowerCase()}).`
              : "Pick a spell from the list.");
    els.input.classList.remove("shake"); void els.input.offsetWidth; els.input.classList.add("shake");
    return;
  }
  if (state.guesses.includes(spell.name)) { say(`You already guessed ${spell.name}.`); return; }

  state.guesses.push(spell.name);
  if (isOver()) recordStats();
  saveStore();

  say("");
  els.input.value = "";
  closeList();
  renderRow(spell, true);
  renderSummary();
  renderSlots();
  renderClue();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => { renderResult(); renderModes(); }, reduced ? 0 : COLUMNS.length * 80 + 450);
}

function recordStats() {
  if (state.recorded) return;
  const s = state.stats;
  s.played++;
  if (isWon()) {
    s.wins++;
    s.streak = s.lastWin === TODAY - 1 ? s.streak + 1 : 1;
    s.best = Math.max(s.best, s.streak);
    s.lastWin = TODAY;
    s.dist[state.guesses.length - 1]++;
  } else {
    s.streak = 0;
  }
  state.recorded = true;
}

/* ---------- Autocomplete ---------- */
let active = -1;
let current = [];      // [{ spell, via }]  "via" is the alias that matched, if any

function findMatches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const guessed = new Set(state.guesses);
  const starts = [], contains = [];
  for (const s of POOL) {
    if (guessed.has(s.name)) continue;
    for (const n of [s.name, ...s.aliases]) {
      const l = n.toLowerCase();
      if (l.startsWith(q)) { starts.push({ spell: s, via: n === s.name ? null : n }); break; }
      if (l.includes(q)) { contains.push({ spell: s, via: n === s.name ? null : n }); break; }
    }
  }
  return starts.concat(contains).slice(0, 8);
}

function describe(s) {
  return s.level === 0 ? `${s.school} cantrip` : `${ordinal(s.level)}-level ${s.school.toLowerCase()}`;
}

function openList() {
  current = findMatches(els.input.value);
  active = current.length ? 0 : -1;
  els.list.replaceChildren(...current.map(({ spell, via }, i) => {
    const li = document.createElement("li");
    li.id = `opt-${i}`;
    li.role = "option";
    li.innerHTML = `<span></span><small></small>`;
    li.firstChild.textContent = spell.name + (via ? ` (${via})` : "");
    li.lastChild.textContent = describe(spell);
    li.addEventListener("mousedown", e => { e.preventDefault(); submitGuess(spell.name); });
    return li;
  }));
  els.list.hidden = !current.length;
  els.input.setAttribute("aria-expanded", String(!!current.length));
  updateActive();
}

function closeList() {
  els.list.hidden = true;
  els.input.setAttribute("aria-expanded", "false");
  current = []; active = -1;
}

function updateActive() {
  [...els.list.children].forEach((li, i) => li.setAttribute("aria-selected", i === active));
  if (active >= 0) {
    els.input.setAttribute("aria-activedescendant", `opt-${active}`);
    els.list.children[active].scrollIntoView({ block: "nearest" });
  } else {
    els.input.removeAttribute("aria-activedescendant");
  }
}

els.input.addEventListener("input", openList);
els.input.addEventListener("blur", () => setTimeout(closeList, 100));
els.input.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" && current.length) { active = (active + 1) % current.length; updateActive(); e.preventDefault(); }
  else if (e.key === "ArrowUp" && current.length) { active = (active - 1 + current.length) % current.length; updateActive(); e.preventDefault(); }
  else if (e.key === "Escape") closeList();
  else if (e.key === "Enter") {
    e.preventDefault();
    submitGuess(active >= 0 ? current[active].spell.name : els.input.value);
  }
});
els.guessBtn.addEventListener("click", () =>
  submitGuess(active >= 0 && current.length ? current[active].spell.name : els.input.value));

els.clueBtn.addEventListener("click", () => {
  state.clueShown = true;
  saveStore();
  renderClue();
});

/* =========================================================================
   Easter egg: click the "D" in the title 7 times to call on the gods.
   A d100 Divine Intervention check (DC 20: a roll of 20 or lower succeeds)
   reveals up to 3 summary tiles the player hasn't found yet, shaded violet.
   It's on top of the normal clue, not instead of it. Usable once, ever, per
   browser.
   The die is the tumble-then-settle roller from the tavern dice tray.
   ========================================================================= */
const DIVINE = { clicks: 7, dc: 20, sides: 100, reveals: 3, showFor: 5500 };
let divineClicks = 0, divineClickTimer = 0;

$("egg-d").addEventListener("click", () => {
  if (store.divineUsed) return;
  clearTimeout(divineClickTimer);
  divineClickTimer = setTimeout(() => { divineClicks = 0; }, 2000);   // clicks must come in a burst
  if (++divineClicks < DIVINE.clicks) return;
  divineClicks = 0;
  store.divineUsed = true;   // spent the moment it starts, so a reload mid-roll doesn't earn a retry
  saveStore();
  divineIntervention();
});

function divineIntervention() {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const roll = 1 + Math.floor(Math.random() * DIVINE.sides);
  const success = roll <= DIVINE.dc;

  const box = document.createElement("div");
  box.className = "divine";
  box.setAttribute("role", "status");
  box.innerHTML = `
    <div class="divine-die"><span class="divine-shape" aria-hidden="true"></span><span class="divine-face">?</span><span class="divine-kind">d100</span></div>
    <div class="divine-text"><strong>Divine Intervention</strong><span>check · DC ${DIVINE.dc}</span><b class="divine-result"></b></div>`;
  document.body.append(box);
  const die = box.querySelector(".divine-die"), face = box.querySelector(".divine-face");

  // Tumble through random faces, then land on the real roll
  setTimeout(() => {
    die.classList.add("rolling");
    const tumble = setInterval(() => { face.textContent = 1 + Math.floor(Math.random() * DIVINE.sides); }, 70);
    setTimeout(() => {
      clearInterval(tumble);
      face.textContent = roll;
      die.classList.replace("rolling", "settled");
      const result = box.querySelector(".divine-result");
      result.textContent = success ? "Success!!!" : "Failed";
      result.classList.add(success ? "success" : "failed");
      if (success) divineReveal();
      setTimeout(() => (calm ? box.remove() : dissolve(box)), DIVINE.showFor);
    }, calm ? 0 : 900 + Math.random() * 700);
  }, calm ? 0 : 450);
}

/* Reveal up to DIVINE.reveals summary columns the player hasn't turned green yet */
function divineReveal() {
  if (isWon()) { say("The gods smile on you, but you've already solved it."); return; }
  const guesses = guessedSpells();
  const hidden = COLUMNS.map((_, i) => i).filter(i =>
    !state.divineCols.includes(i) && !guesses.some(g => compare(COLUMNS[i], g, ANSWER).cls === "good"));
  const picks = shuffled(hidden, Math.floor(Math.random() * 1e9)).slice(0, DIVINE.reveals);
  if (!picks.length) { say("The gods smile on you, but there's nothing left to reveal."); return; }
  state.divineCols.push(...picks);
  saveStore();
  renderSummary();
  const names = picks.sort((a, b) => a - b).map(i => COLUMNS[i].label);
  say(`The gods reveal the ${names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0]}.`);
}

/* "I don't feel so good": the box crumbles into dust that drifts away,
   sweeping left to right, while the box itself fades out behind it */
function dissolve(el) {
  const r = el.getBoundingClientRect();
  const colours = ["#d9a93f", "#8a5a16", "#eadcc0", "#3a2f22", "#b3a081"];
  for (let i = 0; i < 140; i++) {
    const p = document.createElement("span");
    p.className = "dust";
    const x = Math.random(), y = Math.random(), size = 2 + Math.random() * 3;
    Object.assign(p.style, {
      left: `${r.left + x * r.width}px`, top: `${r.top + y * r.height}px`,
      width: `${size}px`, height: `${size}px`,
      background: colours[i % colours.length],
      animationDelay: `${x * 1.1 + Math.random() * 0.4}s`,   // the left side goes first
      animationDuration: `${1.2 + Math.random() * 1.2}s`,
    });
    p.style.setProperty("--dx", `${40 + Math.random() * 120}px`);
    p.style.setProperty("--dy", `${-20 - Math.random() * 80}px`);
    document.body.append(p);
    p.addEventListener("animationend", () => p.remove());
  }
  el.classList.add("dissolving");
  setTimeout(() => el.remove(), 2600);
}

/* =========================================================================
   Sharing, stats dialog, countdown
   ========================================================================= */
async function shareResult() {
  const emoji = { good: "🟩", part: "🟨", bad: "🟥" };
  const rows = guessedSpells().map(g => COLUMNS.map(c => emoji[compare(c, g, ANSWER).cls]).join(""));
  const score = isWon() ? state.guesses.length : "X";
  const text = [
    `5eSpellDLE ${MODE.label} #${TODAY + 1} ${score}/${MAX_GUESSES}${state.clueShown ? " (clue used)" : ""}`,
    ...rows,
    location.origin + location.pathname + "#" + MODE.id,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    say("Result copied. Paste it anywhere to share.");
  } catch {
    window.prompt("Copy your result:", text);
  }
}

function openStats() {
  const s = state.stats;
  const streak = s.lastWin === TODAY || s.lastWin === TODAY - 1 ? s.streak : 0;
  const winPct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  $("stats-title").textContent = `${MODE.label} stats`;
  $("stat-grid").innerHTML = [
    [s.played, "Played"], [winPct, "Win %"], [streak, "Streak"], [s.best, "Best streak"],
  ].map(([v, l]) => `<div><strong>${v}</strong><span>${l}</span></div>`).join("");

  const max = Math.max(1, ...s.dist);
  $("dist").innerHTML = s.dist.map((n, i) => {
    const today = isWon() && state.guesses.length === i + 1 ? " today" : "";
    return `<li><b>${i + 1}</b><span class="bar${today}" style="width:${8 + (n / max) * 88}%">${n}</span></li>`;
  }).join("");
  $("stats-dialog").showModal();
}
$("stats-btn").addEventListener("click", openStats);

function tick() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const secs = Math.max(0, Math.floor((midnight - now) / 1000));
  if (secs === 0) { location.reload(); return; }
  const pad = n => String(n).padStart(2, "0");
  $("countdown").textContent = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
}

/* =========================================================================
   Start
   ========================================================================= */
renderHeader();
/* Looks: data-theme sets the page background, data-scroll the style of the
   parchment scroll the game sits on. Every day the scroll matches the school
   of that day's Grand Magus answer, whichever mode you play (a quiet hint for
   anyone who notices); schools without their own design yet use the plain
   scroll. The testing buttons below can override both locally. */
const BACKGROUNDS = ["tavern", "night"];
const SCROLLS = ["daily", "plain", "abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"];
const LOOK_KEY = "5espelldle-look";
const DAILY_SCROLL = answerFor(MODES.find(m => m.id === "magus")).answer.school.toLowerCase();
let look = { background: BACKGROUNDS[0], scroll: "daily" };
try { look = { ...look, ...JSON.parse(localStorage.getItem(LOOK_KEY)) }; } catch { /* storage unavailable */ }
function applyLook() {
  if (!BACKGROUNDS.includes(look.background)) look.background = BACKGROUNDS[0];
  if (!SCROLLS.includes(look.scroll)) look.scroll = "daily";
  document.documentElement.dataset.theme = look.background;
  document.documentElement.dataset.scroll = look.scroll === "daily" ? DAILY_SCROLL : look.scroll;
}
applyLook();

setMode(location.hash.slice(1) || store.lastMode || DEFAULT_MODE);
window.addEventListener("hashchange", () => setMode(location.hash.slice(1)));
tick();
setInterval(tick, 1000);

/* =========================================================================
   Local testing: a reset button that only appears when the page runs on
   your own computer (Live Server or a double-clicked file), never online.
   ========================================================================= */
if (["localhost", "127.0.0.1", ""].includes(location.hostname)) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dev-reset";
  btn.textContent = "Reset progress (local only)";
  btn.title = "Clears today's guesses and all stats in every mode";
  btn.addEventListener("click", () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
    location.reload();
  });
  document.body.append(btn);

  // Look preview: one button cycles the background, one the scroll style
  const lookBtn = (field, options, label, bottom) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dev-reset dev-look";
    b.style.bottom = bottom;
    const show = () => {
      const v = look[field];
      b.textContent = `${label}: ${v === "daily" ? `daily (${DAILY_SCROLL})` : v}`;
    };
    b.addEventListener("click", () => {
      look[field] = options[(options.indexOf(look[field]) + 1) % options.length];
      applyLook();
      try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* storage unavailable */ }
      show();
    });
    show();
    document.body.append(b);
  };
  lookBtn("scroll", SCROLLS, "Scroll", "12px");
  lookBtn("background", BACKGROUNDS, "Background", "48px");
}
