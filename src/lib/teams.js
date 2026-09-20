// Team Builder store + Showdown/PokéPaste import-export. A team holds up to 6
// "sets" (species + level + nature + ability + item + EVs/IVs + 4 moves).
// Persisted under localStorage `pokemmo:teams`. Set values are plain text
// (species via monId; ability/item/move are names) so it stays in sync with
// pokemmo.json and round-trips through Showdown format cleanly.

const LS_TEAMS = 'pokemmo:teams';
export const TEAMS_VERSION = 1;
export const MAX_MEMBERS = 6;

const rid = (p) => p + Math.random().toString(36).slice(2, 9);
const EV_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const SD_LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const SD_KEY = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe', spatk: 'spa', spdef: 'spd', spd_: 'spd' };

export function blankSet() {
  return {
    id: rid('s_'),
    monId: null,
    boxMonId: null,
    level: 100,
    nature: 'Hardy',
    ability: '',
    item: '',
    gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    moves: ['', '', '', ''],
  };
}
export function newTeam(name) {
  return { id: rid('t_'), name: name || 'New Team', members: [] };
}
export function emptyStore() {
  const t = newTeam('Team 1');
  return { version: TEAMS_VERSION, teams: [t], activeTeamId: t.id };
}

/* ── normalize / persistence ── */
function clampLevel(l) { const n = Math.round(Number(l)); return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 100; }
function clampIV(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(31, Math.max(0, n)) : 31; }
function clampEV(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(252, Math.max(0, n)) : 0; }

export function normalizeSet(s) {
  if (!s || typeof s !== 'object') return null;
  const base = blankSet();
  const evs = {}, ivs = {};
  for (const k of EV_KEYS) { evs[k] = clampEV(s.evs?.[k] ?? 0); ivs[k] = clampIV(s.ivs?.[k] ?? 31); }
  return {
    id: typeof s.id === 'string' && s.id ? s.id : base.id,
    monId: Number.isFinite(Number(s.monId)) && s.monId != null ? Number(s.monId) : null,
    // Which Box mon this set came from, so the Box can mark it as on the team.
    boxMonId: typeof s.boxMonId === 'string' && s.boxMonId ? s.boxMonId : null,
    level: clampLevel(s.level ?? 100),
    nature: typeof s.nature === 'string' && s.nature ? s.nature : 'Hardy',
    ability: typeof s.ability === 'string' ? s.ability : '',
    item: typeof s.item === 'string' ? s.item : '',
    gender: ['M', 'F'].includes(s.gender) ? s.gender : '',
    evs, ivs,
    moves: Array.isArray(s.moves) ? [0, 1, 2, 3].map((i) => (typeof s.moves[i] === 'string' ? s.moves[i] : '')) : ['', '', '', ''],
  };
}
function normalizeTeam(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    id: typeof t.id === 'string' && t.id ? t.id : rid('t_'),
    name: typeof t.name === 'string' && t.name.trim() ? t.name : 'Team',
    members: (Array.isArray(t.members) ? t.members : []).map(normalizeSet).filter(Boolean).slice(0, MAX_MEMBERS),
  };
}
export function normalizeStore(obj) {
  const teams = (Array.isArray(obj?.teams) ? obj.teams : []).map(normalizeTeam).filter(Boolean);
  if (!teams.length) return emptyStore();
  const activeTeamId = teams.some((t) => t.id === obj.activeTeamId) ? obj.activeTeamId : teams[0].id;
  return { version: TEAMS_VERSION, teams, activeTeamId };
}
export function loadStore() {
  if (typeof window === 'undefined') return emptyStore();
  try { const raw = localStorage.getItem(LS_TEAMS); return raw ? normalizeStore(JSON.parse(raw)) : emptyStore(); }
  catch { return emptyStore(); }
}
export function saveStore(store) {
  try { localStorage.setItem(LS_TEAMS, JSON.stringify(normalizeStore(store))); } catch { /* ignore */ }
}

/* ── team mutations (pure) ── */
export const teamById = (s, id) => s.teams.find((t) => t.id === id) || null;
export function addTeam(s, name) { const t = newTeam(name || `Team ${s.teams.length + 1}`); return { ...s, teams: [...s.teams, t], activeTeamId: t.id }; }
export function renameTeam(s, id, name) { return { ...s, teams: s.teams.map((t) => (t.id === id ? { ...t, name: name || t.name } : t)) }; }
export function deleteTeam(s, id) {
  if (s.teams.length <= 1) return { ...s, teams: s.teams.map((t) => (t.id === id ? { ...t, members: [] } : t)) };
  const teams = s.teams.filter((t) => t.id !== id);
  return { ...s, teams, activeTeamId: s.activeTeamId === id ? teams[0].id : s.activeTeamId };
}
export function duplicateTeam(s, id) {
  const t = teamById(s, id); if (!t) return s;
  const copy = { id: rid('t_'), name: t.name + ' (copy)', members: t.members.map((m) => ({ ...normalizeSet(m), id: rid('s_') })) };
  return { ...s, teams: [...s.teams, copy], activeTeamId: copy.id };
}
export function setActiveTeam(s, id) { return { ...s, activeTeamId: id }; }
function mapTeam(s, id, fn) { return { ...s, teams: s.teams.map((t) => (t.id === id ? fn(t) : t)) }; }
export function addMember(s, teamId, set) { return mapTeam(s, teamId, (t) => (t.members.length >= MAX_MEMBERS ? t : { ...t, members: [...t.members, normalizeSet(set) || blankSet()] })); }
export function updateMember(s, teamId, setId, patch) { return mapTeam(s, teamId, (t) => ({ ...t, members: t.members.map((m) => (m.id === setId ? { ...m, ...patch } : m)) })); }
export function removeMember(s, teamId, setId) { return mapTeam(s, teamId, (t) => ({ ...t, members: t.members.filter((m) => m.id !== setId) })); }
// Push a Box mon's current details into every team set built from it, across
// ALL teams — so editing a mon in the Box (level, moves, evolution…) doesn't
// leave stale copies sitting in your lineups. EVs are left alone; they're a
// team-side choice the Box knows nothing about.
//
// Sets saved before sets tracked their source mon have no boxMonId; those are
// adopted when the species matches and nothing else claims them.
export function syncSetsFromBoxMon(s, mon) {
  if (!mon?.id) return s;
  let changed = false;
  const teams = s.teams.map((t) => {
    const claimed = new Set(t.members.map((m) => m.boxMonId).filter(Boolean));
    const members = t.members.map((set) => {
      const exact = set.boxMonId === mon.id;
      const adopt = !set.boxMonId && !claimed.has(mon.id) && set.monId === mon.species;
      if (!exact && !adopt) return set;
      changed = true;
      return {
        ...set,
        boxMonId: mon.id,
        monId: mon.species ?? set.monId,
        level: mon.level || set.level,
        nature: mon.nature || set.nature,
        ability: mon.ability || set.ability,
        item: mon.item ?? set.item,
        gender: ['M', 'F'].includes(mon.gender) ? mon.gender : set.gender,
        ivs: { ...set.ivs, ...(mon.ivs || {}) },
        moves: [0, 1, 2, 3].map((i) => mon.moves?.[i] || set.moves?.[i] || ''),
      };
    });
    return changed ? { ...t, members } : t;
  });
  return changed ? { ...s, teams } : s;
}

export function setTeamMembers(s, teamId, members) { return mapTeam(s, teamId, (t) => ({ ...t, members: members.map(normalizeSet).filter(Boolean).slice(0, MAX_MEMBERS) })); }

/* ── Showdown / PokéPaste ── */
function evString(evs) {
  return EV_KEYS.filter((k) => evs[k] > 0).map((k) => `${evs[k]} ${SD_LABEL[k]}`).join(' / ');
}
function ivString(ivs) {
  return EV_KEYS.filter((k) => ivs[k] !== 31).map((k) => `${ivs[k]} ${SD_LABEL[k]}`).join(' / ');
}
export function setToShowdown(set, speciesName) {
  const lines = [];
  lines.push(`${speciesName || 'Unknown'}${set.item ? ` @ ${set.item}` : ''}`);
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  if (set.level && set.level !== 100) lines.push(`Level: ${set.level}`);
  const ev = evString(set.evs); if (ev) lines.push(`EVs: ${ev}`);
  if (set.nature) lines.push(`${set.nature} Nature`);
  const iv = ivString(set.ivs); if (iv) lines.push(`IVs: ${iv}`);
  for (const mv of set.moves) if (mv) lines.push(`- ${mv}`);
  return lines.join('\n');
}
export function teamToShowdown(team, nameOf) {
  return team.members.map((m) => setToShowdown(m, nameOf(m.monId))).join('\n\n');
}
function applyStatLine(target, str) {
  for (const part of str.split('/')) {
    const m = part.trim().match(/^(\d+)\s+(\w+)$/);
    if (!m) continue;
    const key = SD_KEY[m[2].toLowerCase()];
    if (key) target[key] = Number(m[1]);
  }
}
function parseSet(block, resolveSpecies) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const set = blankSet();
  let first = lines[0];
  const at = first.lastIndexOf(' @ ');
  if (at !== -1) { set.item = first.slice(at + 3).trim(); first = first.slice(0, at).trim(); }
  let species = first;
  const paren = first.match(/\(([^)]+)\)\s*$/);
  if (paren) {
    const inside = paren[1].trim();
    if (inside === 'M' || inside === 'F') { set.gender = inside; species = first.replace(/\s*\([MF]\)\s*$/, '').trim(); }
    else species = inside; // "Nickname (Species)"
  }
  set.monId = resolveSpecies(species);
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]; let m;
    if ((m = l.match(/^Ability:\s*(.+)$/i))) set.ability = m[1].trim();
    else if ((m = l.match(/^Level:\s*(\d+)/i))) set.level = clampLevel(m[1]);
    else if ((m = l.match(/^IVs:\s*(.+)$/i))) applyStatLine(set.ivs, m[1]);
    else if ((m = l.match(/^EVs:\s*(.+)$/i))) applyStatLine(set.evs, m[1]);
    else if (/Nature$/i.test(l)) set.nature = l.replace(/\s*Nature$/i, '').trim();
    else if ((m = l.match(/^-\s*(.+)$/))) { const idx = set.moves.findIndex((x) => !x); if (idx !== -1) set.moves[idx] = m[1].split('/')[0].trim(); }
  }
  return set;
}
// Parse a whole team (mons separated by blank lines). Returns { members, error }.
export function teamFromShowdown(text, resolveSpecies) {
  try {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const members = blocks.map((b) => parseSet(b, resolveSpecies)).filter(Boolean).slice(0, MAX_MEMBERS);
    return members.length ? { members, error: null } : { members: null, error: 'No sets found.' };
  } catch {
    return { members: null, error: 'Could not parse that team.' };
  }
}

export function storeToJSON(store) { return JSON.stringify(normalizeStore(store), null, 2); }
