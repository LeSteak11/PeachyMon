// The Box — a persistent collection of the Pokémon the player owns, organized
// into named boxes (PokéMMO-style: Comp, Shiny, To Sell, …). A first-class
// feature: the Box page manages it, and the breeding planner pulls eligible
// breeders from selected boxes.
//
// Stored under localStorage `pokemmo:box`.
//   v3: { version:3, boxes:[{ id, name, mons:[Mon] }], activeBoxId }
// Migrates from the earlier flat shapes (v2 { mons } / bare array) into a single
// "Box 1". A Mon records REAL 0–31 IV values, nature by name, gender, and
// shiny/alpha — the planner derives "which IVs are 31" from it.

import { IV_KEYS } from './breeding/data.js';

const LS_BOX = 'pokemmo:box';
export const BOX_VERSION = 3;

const rid = (p) => p + Math.random().toString(36).slice(2, 9);

export function blankBoxMon() {
  return {
    id: rid('m_'),
    species: null,
    gender: 'F',
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: '',
    ability: '',
    level: null,   // in-game level (captured from the summary header)
    item: '',      // held item name
    nickname: '',  // '' when not nicknamed
    moves: ['', '', '', ''],
    shiny: false,
    alpha: false,
    source: 'manual', // 'manual' | 'capture' | 'import'
    addedAt: null,
  };
}

export function newBox(name) {
  return { id: rid('box_'), name: name || 'New Box', mons: [] };
}

export function emptyStore() {
  const b = newBox('Box 1');
  return { version: BOX_VERSION, boxes: [b], activeBoxId: b.id };
}

/* ── normalization / migration ───────────────────────────────────────────── */

function clampIV(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(31, Math.max(0, n));
}

export function normalizeMon(m) {
  if (!m || typeof m !== 'object') return null;
  const ivsIn = m.ivs || {};
  const ivs = {};
  for (const k of IV_KEYS) {
    const v = ivsIn[k];
    ivs[k] = v === true ? 31 : v === false ? 0 : clampIV(v);
  }
  const speciesRaw = m.species != null ? m.species : m.monId;
  const species = speciesRaw != null && Number.isFinite(Number(speciesRaw)) ? Number(speciesRaw) : null;
  return {
    id: typeof m.id === 'string' && m.id ? m.id : rid('m_'),
    species,
    gender: ['F', 'M', 'N', 'D'].includes(m.gender) ? m.gender : 'F',
    ivs,
    nature: typeof m.nature === 'string' ? m.nature : '',
    ability: typeof m.ability === 'string' ? m.ability : '',
    level: Number.isInteger(m.level) && m.level >= 1 && m.level <= 100 ? m.level : null,
    item: typeof m.item === 'string' ? m.item : '',
    nickname: typeof m.nickname === 'string' ? m.nickname : '',
    moves: [0, 1, 2, 3].map((i) => (Array.isArray(m.moves) && typeof m.moves[i] === 'string' ? m.moves[i] : '')),
    shiny: !!m.shiny,
    alpha: !!m.alpha,
    source: ['manual', 'capture', 'import'].includes(m.source) ? m.source : 'manual',
    addedAt: typeof m.addedAt === 'string' ? m.addedAt : null,
  };
}

function normalizeBox(b) {
  if (!b || typeof b !== 'object') return null;
  return {
    id: typeof b.id === 'string' && b.id ? b.id : rid('box_'),
    name: typeof b.name === 'string' && b.name.trim() ? b.name : 'Box',
    mons: Array.isArray(b.mons) ? b.mons.map(normalizeMon).filter(Boolean) : [],
  };
}

// Coerce arbitrary parsed JSON (v3 store, legacy v2 { mons }, or bare array)
// into a clean v3 store.
export function normalizeStore(obj) {
  if (obj && Array.isArray(obj.boxes)) {
    const boxes = obj.boxes.map(normalizeBox).filter(Boolean);
    if (boxes.length === 0) return emptyStore();
    const activeBoxId = boxes.some((b) => b.id === obj.activeBoxId) ? obj.activeBoxId : boxes[0].id;
    return { version: BOX_VERSION, boxes, activeBoxId };
  }
  // Legacy flat list → one box.
  const mons = Array.isArray(obj?.mons) ? obj.mons : Array.isArray(obj) ? obj : [];
  const box = { id: rid('box_'), name: 'Box 1', mons: mons.map(normalizeMon).filter(Boolean) };
  return { version: BOX_VERSION, boxes: [box], activeBoxId: box.id };
}

export function loadStore() {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const raw = localStorage.getItem(LS_BOX);
    if (!raw) return emptyStore();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

export function saveStore(store) {
  try { localStorage.setItem(LS_BOX, JSON.stringify(normalizeStore(store))); } catch { /* ignore */ }
}

/* ── queries ─────────────────────────────────────────────────────────────── */

export function boxById(store, id) {
  return store.boxes.find((b) => b.id === id) || null;
}

// Every mon across all boxes, each tagged with its boxId.
export function allMons(store) {
  return store.boxes.flatMap((b) => b.mons.map((m) => ({ ...m, boxId: b.id })));
}

// Mons in the given set of box ids (tagged with boxId).
export function monsInBoxes(store, boxIds) {
  const set = new Set(boxIds);
  return store.boxes.filter((b) => set.has(b.id)).flatMap((b) => b.mons.map((m) => ({ ...m, boxId: b.id })));
}

export function perfectCount(m) {
  return IV_KEYS.reduce((n, k) => n + (m.ivs?.[k] === 31 ? 1 : 0), 0);
}

/* ── mutations (pure: return a new store) ────────────────────────────────── */

export function addBox(store, name) {
  const b = newBox(name || `Box ${store.boxes.length + 1}`);
  return { ...store, boxes: [...store.boxes, b], activeBoxId: b.id };
}
export function renameBox(store, boxId, name) {
  return { ...store, boxes: store.boxes.map((b) => (b.id === boxId ? { ...b, name: name || b.name } : b)) };
}
export function deleteBox(store, boxId) {
  if (store.boxes.length <= 1) return { ...store, boxes: store.boxes.map((b) => (b.id === boxId ? { ...b, mons: [] } : b)) };
  const boxes = store.boxes.filter((b) => b.id !== boxId);
  const activeBoxId = store.activeBoxId === boxId ? boxes[0].id : store.activeBoxId;
  return { ...store, boxes, activeBoxId };
}
export function setActiveBox(store, boxId) {
  return { ...store, activeBoxId: boxId };
}
export function addMon(store, boxId, mon) {
  return { ...store, boxes: store.boxes.map((b) => (b.id === boxId ? { ...b, mons: [...b.mons, mon] } : b)) };
}
export function updateMon(store, monId, patch) {
  return { ...store, boxes: store.boxes.map((b) => ({ ...b, mons: b.mons.map((m) => (m.id === monId ? { ...m, ...patch } : m)) })) };
}
export function removeMon(store, monId) {
  return { ...store, boxes: store.boxes.map((b) => ({ ...b, mons: b.mons.filter((m) => m.id !== monId) })) };
}
export function moveMon(store, monId, toBoxId) {
  let moving = null;
  const stripped = store.boxes.map((b) => {
    const keep = [];
    for (const m of b.mons) { if (m.id === monId) moving = m; else keep.push(m); }
    return { ...b, mons: keep };
  });
  if (!moving) return store;
  return { ...store, boxes: stripped.map((b) => (b.id === toBoxId ? { ...b, mons: [...b.mons, moving] } : b)) };
}
export function addMons(store, boxId, mons) {
  return { ...store, boxes: store.boxes.map((b) => (b.id === boxId ? { ...b, mons: [...b.mons, ...mons] } : b)) };
}

/* ── import / export ─────────────────────────────────────────────────────── */

export function monSignature(m) {
  const ivs = IV_KEYS.map((k) => m.ivs?.[k] ?? 0).join(',');
  return `${m.species}|${m.gender}|${ivs}|${m.nature || ''}|${m.shiny ? 1 : 0}|${m.alpha ? 1 : 0}`;
}
export function mergeMons(existing, incoming) {
  const seen = new Set(existing.map(monSignature));
  const out = [...existing];
  for (const m of incoming) {
    const sig = monSignature(m);
    if (!seen.has(sig)) { seen.add(sig); out.push(m); }
  }
  return out;
}

// Append an imported store's boxes as NEW boxes (fresh ids), preserving the
// user's existing boxes. Returns the new store with the first imported box made
// active.
export function appendImportedBoxes(store, imported) {
  const boxes = imported.boxes.map((b) => ({
    id: rid('box_'),
    name: b.name,
    mons: b.mons.map((m) => ({ ...m, id: rid('m_'), source: 'import' })),
  }));
  if (boxes.length === 0) return store;
  return { ...store, boxes: [...store.boxes, ...boxes], activeBoxId: boxes[0].id };
}

// `nameOf(id)` (optional) adds a readable `name` to each mon — ignored on import.
export function storeToJSON(store, nameOf) {
  const out = normalizeStore(store);
  if (nameOf) {
    out.boxes = out.boxes.map((b) => ({ ...b, mons: b.mons.map((m) => ({ id: m.id, name: nameOf(m.species), ...m })) }));
  }
  return JSON.stringify(out, null, 2);
}

// Plain-text Box summary for pasting into an AI chat — one line per mon.
export function boxToAiText(store, nameOf) {
  const g = { M: '♂', F: '♀', N: 'genderless', D: '' };
  const lines = ['My PokéMMO Box (IVs are HP/Atk/Def/SpA/SpD/Spe, 0-31):'];
  for (const b of normalizeStore(store).boxes) {
    if (!b.mons.length) continue;
    lines.push('', `${b.name}:`);
    for (const m of b.mons) {
      const name = nameOf(m.species) || 'Unknown';
      const bits = [m.nickname ? `${m.nickname} (${name})` : name];
      if (g[m.gender]) bits[0] += ` ${g[m.gender]}`;
      if (m.level) bits.push(`Lv. ${m.level}`);
      if (m.nature) bits.push(`${m.nature} nature`);
      if (m.ability) bits.push(`ability ${m.ability}`);
      bits.push(`held item: ${m.item || 'none'}`);
      bits.push(`IVs ${IV_KEYS.map((k) => m.ivs[k]).join('/')}`);
      const mv = m.moves.filter(Boolean);
      if (mv.length) bits.push(`moves: ${mv.join(' / ')}`);
      if (m.shiny) bits.push('shiny');
      if (m.alpha) bits.push('alpha');
      lines.push(`- ${bits.join(', ')}`);
    }
  }
  return lines.join('\n');
}

// Parse imported text → { store, error }. Accepts a v3 store or a legacy flat
// list (which becomes a single box). Never throws.
export function storeFromJSON(text) {
  try {
    return { store: normalizeStore(JSON.parse(text)), error: null };
  } catch {
    return { store: null, error: 'Could not read that file — expected a Box JSON export.' };
  }
}
