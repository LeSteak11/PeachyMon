// Parse the OCR output of a captured PokéMMO summary panel into a structured
// mon for the Box. Pure + dependency-light so it can be unit-tested in the
// browser with a synthetic payload (no native capture needed).
//
// Input payload (produced by the Rust capture/OCR command):
//   {
//     text:   string,                       // full recognized text (fallback)
//     width:  number, height: number,       // cropped image dimensions
//     words: [{ text, x, y, w, h, green? }] // per-word boxes; green = the IV
//                                           //   cell was tinted green (a 31)
//   }
//
// Output:
//   { ivs:{hp,atk,def,spa,spd,spe}, nature, gender, speciesName, confidence }
// Any field we can't read is left null / 0 so the user confirms it in the Box.

import { IV_KEYS, NATURE_NAMES } from './data.js';

const NATURE_SET = new Set(NATURE_NAMES.map((n) => n.toLowerCase()));

// Group words into visual lines by y-proximity (tolerance ~ 60% of the median
// word height). Returns lines sorted top→bottom, words within each left→right.
function groupLines(words) {
  if (!words.length) return [];
  const heights = words.map((w) => w.h || 0).filter(Boolean).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 12;
  const tol = Math.max(6, medH * 0.6);
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const lines = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(l.yc - (w.y + (w.h || 0) / 2)) <= tol);
    if (line) {
      line.words.push(w);
      line.yc = (line.yc * (line.words.length - 1) + (w.y + (w.h || 0) / 2)) / line.words.length;
    } else {
      lines.push({ yc: w.y + (w.h || 0) / 2, words: [w] });
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.yc - b.yc);
}

// Numeric tokens (1–3 digits) within a list of words, in reading order, each
// tagged with whether its source word was green (an in-game 31 cue).
function numberTokens(words) {
  const out = [];
  for (const w of words) {
    const matches = String(w.text).match(/\d{1,3}/g);
    if (!matches) continue;
    for (const m of matches) out.push({ value: parseInt(m, 10), green: !!w.green });
  }
  return out;
}

const labelRe = {
  ivs: /^ivs?$|^iv'?s?:?$/i,
  evs: /^evs?$|^ev'?s?:?$/i,
  nature: /^nature:?$/i,
  level: /^lv\.?$/i,
};

function findLabelLine(lines, re) {
  return lines.find((l) => l.words.some((w) => re.test(String(w.text).replace(/[:.]+$/, ''))));
}

// Words on a line that come after the label word (to its right).
function valuesAfterLabel(line, re) {
  const idx = line.words.findIndex((w) => re.test(String(w.text).replace(/[:.]+$/, '')));
  return idx === -1 ? line.words : line.words.slice(idx + 1);
}

// Stat names as they appear on PokéMMO's IV tab, matched against the row's
// label text lowercased with spaces removed. Windows OCR mangles the small
// "IV:" suffix differently per row ("HPIV:", "'v:", "Atk1V:", "DeflV:"), so we
// never rely on it — only the stat name. Order matters: Sp. stats first.
const IV_ROW_LABELS = [
  ['spa', /[s5]p\W?a/],
  ['spd', /[s5]p\W?d/],
  ['spe', /[s5]pe/],
  ['hp', /hp/],
  ['atk', /att|atk/],
  ['def', /def/],
];

// Returns { hp:{value,green}, … } when at least 4 of the 6 rows were read
// (missing rows become 0 for the user to fix), else null.
// Values are matched by position, not by OCR line: the right-hand header
// ("Patrat ♀ Lv. 5") sits level with the HP row, so OCR line-grouping can pull
// the HP value into the header's line. For each stat label we take the
// leftmost unused number right of where the label starts, at the same height (leftmost = the value
// box, not the "Lv. 5" further right).
function parseIvRows(lines) {
  const isNum = (w) => /^\d{1,2}$/.test(String(w.text).trim());
  const all = lines.flatMap((l) => l.words);
  const heights = all.map((w) => w.h || 0).filter(Boolean).sort((a, b) => a - b);
  const tol = Math.max(6, (heights.length ? heights[Math.floor(heights.length / 2)] : 12) * 0.8);
  const nums = all.filter(isNum);
  // The value boxes are the leftmost numbers; real stat labels start left of
  // them. The header name (Hoppip, Rattata, Spearow…) sits to their right and
  // must never be read as a label.
  const valueCol = nums.length ? Math.min(...nums.map((w) => w.x)) : Infinity;
  const used = new Set();
  const found = {};
  for (const line of lines) {
    const k = line.words.findIndex(isNum);
    const labelWords = k === -1 ? line.words : line.words.slice(0, k);
    if (!labelWords.length) continue;
    const label = labelWords.map((w) => String(w.text)).join('').toLowerCase();
    if (/total/.test(label)) continue;
    const hit = IV_ROW_LABELS.find(([, re]) => re.test(label));
    if (!hit || found[hit[0]]) continue;
    const left = Math.min(...labelWords.map((w) => w.x));
    if (left >= valueCol) continue;
    const yc = labelWords.reduce((sum, w) => sum + w.y + (w.h || 0) / 2, 0) / labelWords.length;
    const val = nums
      .filter((w) => !used.has(w) && w.x > left && Math.abs(w.y + (w.h || 0) / 2 - yc) <= tol)
      .sort((a, b) => a.x - b.x)[0];
    if (!val) continue;
    used.add(val);
    found[hit[0]] = { value: parseInt(val.text, 10), green: !!val.green, x: val.x };
  }
  if (Object.keys(found).length < 4) return null;

  // OCR sometimes drops a label entirely (the HP label, right under the title
  // bar, often vanishes while its value is read fine). The six values always
  // sit in one column in fixed order, so take the column's numbers top→bottom:
  // exactly six → assign HP…Spe by position, overriding label matches.
  const colX = found[Object.keys(found)[0]].x;
  const col = nums
    .filter((w) => Math.abs(w.x - colX) <= tol * 2)
    .sort((a, b) => a.y - b.y);
  if (col.length === 6) {
    return Object.fromEntries(IV_KEYS.map((k, i) => [k, { value: parseInt(col[i].text, 10), green: !!col[i].green }]));
  }
  return Object.fromEntries(IV_KEYS.map((k) => [k, found[k] || { value: 0, green: false }]));
}

export function parseSummary(payload) {
  const words = Array.isArray(payload?.words) ? payload.words : [];
  const text = payload?.text || words.map((w) => w.text).join(' ');
  const lines = groupLines(words);

  const result = {
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: '',
    gender: null,
    speciesName: null,
    confidence: { ivs: false, nature: false, species: false },
    page: null, // 'ivs' when this was PokéMMO's per-row IV tab
    dexNum: null, // from the info tab's "Pokédex: 501" row
    level: null,    // header "Lv. 9" — on every summary tab
    item: null,     // "Item Held: X" — '' when None, null when not seen
    nickname: null, // info tab "Name:" row
    moves: null,    // moves tab: raw move-name texts (resolve with resolveName)
    ability: null,  // moves tab "Ability:" row, raw text
  };

  // ── IVs ── prefer the line anchored by the "IVs" label, then map the six
  // numbers to HP/Atk/Def/SpA/SpD/Spe. Green cells override to 31 (a misread
  // 31→51 still resolves correctly).
  let ivTokens = null;
  const ivLine = findLabelLine(lines, labelRe.ivs);
  if (ivLine) {
    const toks = numberTokens(valuesAfterLabel(ivLine, labelRe.ivs));
    if (toks.length >= 6) ivTokens = toks.slice(0, 6);
  }
  if (!ivTokens) {
    // PokéMMO's IV tab: one row per stat — "HP IV: 15", "Sp. Atk IV: 31", …
    // Identify each row by its stat name and take the first number after it.
    const rowIvs = parseIvRows(lines);
    if (rowIvs) {
      ivTokens = IV_KEYS.map((k) => rowIvs[k]);
      result.page = 'ivs';
    }
  }
  if (!ivTokens) {
    // Fallback: a 6-number slash group where every value ≤ 31 and not all zero
    // (distinguishes IVs from the >31 stats line; "not all zero" skips EVs).
    const groups = [...text.matchAll(/(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})/g)];
    for (const g of groups) {
      const vals = g.slice(1, 7).map(Number);
      if (vals.every((v) => v >= 0 && v <= 31) && vals.some((v) => v > 0)) {
        ivTokens = vals.map((v) => ({ value: v, green: false }));
        break;
      }
    }
  }
  if (ivTokens) {
    IV_KEYS.forEach((k, i) => {
      const t = ivTokens[i];
      let v = t.green ? 31 : Math.min(31, Math.max(0, t.value));
      result.ivs[k] = v;
    });
    result.confidence.ivs = true;
  }

  // ── Nature ── first token on the Nature line that names a real nature.
  const natLine = findLabelLine(lines, labelRe.nature);
  const natSource = natLine ? valuesAfterLabel(natLine, labelRe.nature).map((w) => w.text) : text.split(/\s+/);
  for (const tok of natSource) {
    const clean = String(tok).replace(/[^a-z]/gi, '').toLowerCase();
    if (NATURE_SET.has(clean)) {
      result.nature = NATURE_NAMES.find((n) => n.toLowerCase() === clean);
      result.confidence.nature = true;
      break;
    }
  }

  // ── Pokédex number ── PokéMMO's info tab has a "Pokédex: 501" row; it's the
  // most reliable species signal (dex number == our species id).
  for (const line of lines) {
    const i = line.words.findIndex((w) => /^pok.{0,2}dex:?$/i.test(String(w.text).trim()));
    if (i === -1) continue;
    const num = line.words.slice(i + 1).map((w) => String(w.text).match(/^\d{1,3}$/)).find(Boolean);
    if (num) { result.dexNum = parseInt(num[0], 10); break; }
  }

  // ── Level ── header "Lv. 9" (OCR gives "Lv." "9" or "Lv.9").
  for (const line of lines) {
    const m = line.words.map((w) => String(w.text)).join(' ').match(/\blv\.?\s*(\d{1,3})\b/i);
    if (m && +m[1] >= 1 && +m[1] <= 100) { result.level = +m[1]; break; }
  }

  // ── Held item ── "Item Held: None" in the bottom-right, on every tab.
  for (const line of lines) {
    const m = line.words.map((w) => String(w.text)).join(' ').match(/held\s*:?\s*(.+)$/i);
    if (m) { result.item = /^none\b/i.test(m[1].trim()) ? '' : m[1].trim(); break; }
  }

  // ── Nickname ── info tab "Name: Oshawott" (equals the species if unnamed).
  const nameLine = findLabelLine(lines, /^name:?$/i);
  if (nameLine) {
    const nick = valuesAfterLabel(nameLine, /^name:?$/i).map((w) => String(w.text)).join(' ').trim();
    if (nick) result.nickname = nick;
  }

  // ── Moves tab ── four "Move Name / PP: 35/35" blocks + "Ability: X".
  // A PP line is matched by SHAPE, not the letters "PP": OCR drops the prefix
  // ("35/35") and misreads the slash ("30130", "20 1 20"). Each move name is
  // the left-panel line directly above a PP line.
  const lineText = (l) => l.words.map((w) => String(w.text)).join(' ').trim();
  const isPpLine = (l) => {
    const t = lineText(l);
    return /\bpp\b/i.test(t)
      || /^\d{1,3}\s*[/1lI|]\s*\d{1,3}$/.test(t)   // 35/35, 25 / 25
      || /^\d{4,6}$/.test(t.replace(/\s+/g, ''));  // 30130, 20120
  };
  const ppLines = lines.filter(isPpLine);
  if (ppLines.length >= 2 && result.page !== 'ivs') {
    result.page = 'moves';
    const lvL = findLabelLine(lines, labelRe.level);
    const rightEdge = lvL ? Math.min(...lvL.words.map((w) => w.x)) : Infinity;
    const abilityLine = findLabelLine(lines, /^ability:?$/i);
    const moves = [];
    for (const line of lines) {
      if (abilityLine && line.yc >= abilityLine.yc) break;
      if (isPpLine(line)) continue;
      const ws = line.words.filter((w) => w.x < rightEdge);
      if (!ws.length) continue;
      const h = Math.max(...ws.map((w) => w.h || 10));
      const pp = ppLines.find((l) => l.yc > line.yc && l.yc - line.yc <= h * 3);
      if (!pp) continue;
      const t = ws.map((w) => String(w.text)).join(' ').trim();
      if (t.replace(/[^a-z]/gi, '').length >= 3) moves.push(t);
    }
    result.moves = moves.slice(0, 4);
    if (abilityLine) {
      const ab = valuesAfterLabel(abilityLine, /^ability:?$/i).filter((w) => w.x < rightEdge)
        .map((w) => String(w.text)).join(' ').trim();
      if (ab) result.ability = ab;
    }
  }

  // ── Gender ── PokéMMO draws a ♂/♀ glyph by the name. OCR rarely reads it
  // reliably, so this is best-effort; the user confirms.
  if (/[♂]/.test(text)) result.gender = 'M';
  else if (/[♀]/.test(text)) result.gender = 'F';

  // ── Species name ── the "Lv. N <Name>" line; take the words after the level
  // number, dropping gender glyphs.
  const lvLine = findLabelLine(lines, labelRe.level);
  if (lvLine) {
    // PokéMMO's header reads "Oshawott ♂ Lv. 8" — the name sits BEFORE the
    // level. Walk left from "Lv." over name-like words (max 2, e.g. Mr. Mime).
    const idx = lvLine.words.findIndex((w) => labelRe.level.test(String(w.text).replace(/[:.]+$/, '')));
    const before = [];
    for (let i = idx - 1; i >= 0 && before.length < 2; i--) {
      const t = String(lvLine.words[i].text).replace(/[♂♀]/g, '');
      if (!t) continue;
      if (!/^[A-Za-z.'’\-]+$/.test(t) || /:$/.test(t)) break;
      before.unshift(t);
    }
    if (before.length) { result.speciesName = before.join(' '); result.confidence.species = true; }
  }
  if (lvLine && !result.speciesName) {
    const after = valuesAfterLabel(lvLine, labelRe.level)
      .map((w) => String(w.text))
      .filter((t) => !/^\d+$/.test(t) && !/^[♂♀]$/.test(t));
    const name = after.join(' ').replace(/[♂♀]/g, '').trim();
    if (name) { result.speciesName = name; result.confidence.species = true; }
  }
  if (!result.speciesName) {
    // Fallback: "Lv. 100 Tyranitar" anywhere in the text.
    const m = text.match(/lv\.?\s*\d+\s+([A-Za-z.'’\- ]{3,})/i);
    if (m) result.speciesName = m[1].replace(/[♂♀]/g, '').trim();
  }

  return result;
}

// Resolve a parsed species name to a Pokémon id against the dex. Exact match
// first, then a loose contains/startsWith. Returns id or null.
export function resolveSpecies(name, pokemon) {
  if (!name || !Array.isArray(pokemon)) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  if (!n) return null;
  let hit = pokemon.find((p) => norm(p.name) === n);
  if (hit) return hit.id;
  hit = pokemon.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name)));
  if (hit) return hit.id;
  hit = pokemon.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name)));
  return hit ? hit.id : null;
}

// Match OCR text to a canonical name (moves, abilities, items): exact after
// normalizing, else the closest name within a small edit distance. Returns the
// canonical name or null.
export function resolveName(text, names) {
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(text);
  if (n.length < 3) return null;
  let best = null, bestD = Infinity, tie = false;
  for (const name of names) {
    const m = norm(name);
    if (m === n) return name;
    if (Math.abs(m.length - n.length) > 2) continue;
    const d = editDistance(n, m);
    if (d < bestD) { bestD = d; best = name; tie = false; }
    else if (d === bestD && m !== norm(best)) tie = true;
  }
  // A tie (e.g. "Water Spon" → Water Sport / Water Spout) is a guess: refuse.
  return !tie && bestD <= Math.max(1, Math.floor(n.length / 4)) ? best : null;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
