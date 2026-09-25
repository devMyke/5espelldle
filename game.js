"use strict";

/* =========================================================================
   Settings you might want to change
   ========================================================================= */
const MAX_GUESSES = 10;          // number of spell slots
const CLUE_AFTER = 4;            // guesses before the clue unlocks
const LAUNCH = [2026, 8, 25];    // puzzle #1 date: [year, month (0 = Jan), day]
const SHUFFLE_SEED = 5051;       // changing this changes every future answer
const STORE_KEY = "5espelldle:v1";

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
  // set
  const g = new Set(col.get(guess)), a = new Set(col.get(answer));
  const same = g.size === a.size && [...g].every(x => a.has(x));
  if (same) return { cls: "good" };
  return { cls: [...g].some(x => a.has(x)) ? "part" : "bad" };
}

/* =========================================================================
   Daily answer: every browser computes the same spell from the date,
   so no server is needed. The spell list is shuffled once with a fixed
   seed, then each day takes the next spell from that order.
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

function dailyOrder() {
  const rand = seededRandom(SHUFFLE_SEED);
  const order = SPELLS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const TODAY = dayIndex();
const ANSWER = SPELLS[dailyOrder()[TODAY % SPELLS.length]];
const BY_NAME = new Map(SPELLS.map(s => [s.name.toLowerCase(), s]));

/* =========================================================================
   Saved progress (kept in this browser only)
   ========================================================================= */
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode etc. */ }
}

const store = loadStore();
store.stats ??= { played: 0, wins: 0, streak: 0, best: 0, lastWin: null, dist: Array(MAX_GUESSES).fill(0) };
if (store.day !== TODAY) {
  store.day = TODAY;
  store.guesses = [];
  store.clueShown = false;
  store.recorded = false;
}
saveStore();

const guessedSpells = () => store.guesses.map(n => BY_NAME.get(n.toLowerCase())).filter(Boolean);
const isWon = () => store.guesses.includes(ANSWER.name);
const isOver = () => isWon() || store.guesses.length >= MAX_GUESSES;

/* =========================================================================
   Rendering
   ========================================================================= */
const $ = id => document.getElementById(id);
const els = {
  input: $("guess-input"), list: $("suggestions"), guessBtn: $("guess-btn"),
  clueBtn: $("clue-btn"), clue: $("clue"), rows: $("rows"), summary: $("summary-row"),
  header: $("header-row"), slots: $("slots"), slotsLabel: $("slots-label"),
  message: $("message"), result: $("result"),
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

function renderHeader() {
  const th = document.createElement("th");
  th.textContent = "Spell";
  th.className = "name-col";
  th.scope = "col";
  els.header.append(th);
  for (const col of COLUMNS) {
    const h = document.createElement("th");
    h.scope = "col";
    h.textContent = col.label;
    els.header.append(h);
  }
}

function renderRow(spell, animate) {
  const tr = document.createElement("tr");
  tr.append(cell(spell.name, "tile name"));
  COLUMNS.forEach((col, i) => {
    const r = compare(col, spell, ANSWER);
    const td = cell(col.show(spell), `tile ${r.cls}${r.arrow ? " " + r.arrow : ""}`);
    if (r.arrow) td.title = `The answer's ${col.label.toLowerCase()} is ${r.arrow === "up" ? "higher" : "lower"}`;
    if (animate) {
      td.classList.add("reveal");
      td.style.animationDelay = `${i * 90}ms`;
    }
    tr.append(td);
  });
  els.rows.prepend(tr);            // newest guess on top
}

function renderSummary() {
  els.summary.replaceChildren(cell("Summary", "tile label"));
  const guesses = guessedSpells();
  for (const col of COLUMNS) {
    if (!guesses.length) { els.summary.append(cell("", "tile empty")); continue; }
    const results = guesses.map(g => [g, compare(col, g, ANSWER)]);

    if (results.some(([, r]) => r.cls === "good")) {
      els.summary.append(cell(col.show(ANSWER), "tile good"));
    } else if (col.type === "rank" && results.some(([, r]) => r.arrow)) {
      // Narrow the range: the answer is above every "up" guess and below every "down" guess
      let lo = null, hi = null;
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
  }
}

function renderSlots() {
  const left = MAX_GUESSES - store.guesses.length;
  els.slots.replaceChildren(...Array.from({ length: MAX_GUESSES }, (_, i) => {
    const d = document.createElement("div");
    d.className = "slot" + (i >= left ? " spent" : "");
    return d;
  }));
  els.slotsLabel.textContent = `${left} spell slot${left === 1 ? "" : "s"} left`;
}

function renderClue() {
  const n = store.guesses.length;
  els.clue.textContent = ANSWER.clue;
  els.clue.hidden = !store.clueShown;
  if (store.clueShown) {
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
  if (!isOver()) { els.result.hidden = true; return; }
  const won = isWon();
  els.result.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = won ? ANSWER.name : "Out of spell slots";
  const p = document.createElement("p");
  p.textContent = won
    ? `Solved in ${store.guesses.length} guess${store.guesses.length === 1 ? "" : "es"}. A new spell arrives at midnight.`
    : `Today's spell was ${ANSWER.name}. A new spell arrives at midnight.`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Copy result";
  btn.addEventListener("click", shareResult);
  els.result.append(h, p, btn);
  els.result.hidden = false;
  els.input.disabled = els.guessBtn.disabled = true;
  els.input.placeholder = won ? "Solved – see you tomorrow" : "Come back tomorrow";
}

/* =========================================================================
   Guessing
   ========================================================================= */
function say(text) {
  els.message.textContent = text;
}

function submitGuess(name) {
  const spell = BY_NAME.get(name.trim().toLowerCase());
  if (isOver()) return;
  if (!spell) {
    say("Pick a spell from the list.");
    els.input.classList.remove("shake"); void els.input.offsetWidth; els.input.classList.add("shake");
    return;
  }
  if (store.guesses.includes(spell.name)) { say(`You already guessed ${spell.name}.`); return; }

  store.guesses.push(spell.name);
  if (isOver()) recordStats();
  saveStore();

  say("");
  els.input.value = "";
  closeList();
  renderRow(spell, true);
  renderSummary();
  renderSlots();
  renderClue();
  // Wait for the tiles to finish flipping before showing the result
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(renderResult, reduced ? 0 : COLUMNS.length * 90 + 450);
}

function recordStats() {
  if (store.recorded) return;
  const s = store.stats;
  s.played++;
  if (isWon()) {
    s.wins++;
    s.streak = s.lastWin === TODAY - 1 ? s.streak + 1 : 1;
    s.best = Math.max(s.best, s.streak);
    s.lastWin = TODAY;
    s.dist[store.guesses.length - 1]++;
  } else {
    s.streak = 0;
  }
  store.recorded = true;
}

/* ---------- Autocomplete ---------- */
let active = -1;
let current = [];

function findMatches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const guessed = new Set(store.guesses);
  const starts = [], contains = [];
  for (const s of SPELLS) {
    if (guessed.has(s.name)) continue;
    const n = s.name.toLowerCase();
    if (n.startsWith(q)) starts.push(s);
    else if (n.includes(q)) contains.push(s);
  }
  return starts.concat(contains).slice(0, 8);
}

function describe(s) {
  return s.level === 0 ? `${s.school} cantrip` : `${ordinal(s.level)}-level ${s.school.toLowerCase()}`;
}

function openList() {
  current = findMatches(els.input.value);
  active = current.length ? 0 : -1;
  els.list.replaceChildren(...current.map((s, i) => {
    const li = document.createElement("li");
    li.id = `opt-${i}`;
    li.role = "option";
    li.setAttribute("aria-selected", i === active);
    li.innerHTML = `<span></span><small></small>`;
    li.firstChild.textContent = s.name;
    li.lastChild.textContent = describe(s);
    li.addEventListener("mousedown", e => { e.preventDefault(); submitGuess(s.name); });
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
    submitGuess(active >= 0 ? current[active].name : els.input.value);
  }
});
els.guessBtn.addEventListener("click", () =>
  submitGuess(active >= 0 && current.length ? current[active].name : els.input.value));

els.clueBtn.addEventListener("click", () => {
  store.clueShown = true;
  saveStore();
  renderClue();
});

/* =========================================================================
   Sharing, stats dialog, countdown
   ========================================================================= */
async function shareResult() {
  const emoji = { good: "🟩", part: "🟨", bad: "🟥" };
  const rows = guessedSpells().map(g => COLUMNS.map(c => emoji[compare(c, g, ANSWER).cls]).join(""));
  const score = isWon() ? store.guesses.length : "X";
  const text = [
    `5eSpellDLE #${TODAY + 1} ${score}/${MAX_GUESSES}${store.clueShown ? " (clue used)" : ""}`,
    ...rows,
    location.origin + location.pathname,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    say("Result copied. Paste it anywhere to share.");
  } catch {
    window.prompt("Copy your result:", text);
  }
}

function openStats() {
  const s = store.stats;
  const streak = s.lastWin === TODAY || s.lastWin === TODAY - 1 ? s.streak : 0;
  const winPct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  $("stat-grid").innerHTML = [
    [s.played, "Played"], [winPct, "Win %"], [streak, "Streak"], [s.best, "Best streak"],
  ].map(([v, l]) => `<div><strong>${v}</strong><span>${l}</span></div>`).join("");

  const max = Math.max(1, ...s.dist);
  $("dist").innerHTML = s.dist.map((n, i) => {
    const today = isWon() && store.guesses.length === i + 1 ? " today" : "";
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
$("puzzle-no").textContent = `#${TODAY + 1}`;
$("spell-count").textContent = SPELLS.length;
renderHeader();
guessedSpells().forEach(s => renderRow(s, false));
renderSummary();
renderSlots();
renderClue();
renderResult();
tick();
setInterval(tick, 1000);
