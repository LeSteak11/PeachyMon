// Catch log — how many Pokémon you've EVER caught, independent of what you
// still own. Counters only (no per-catch records), so it stays tiny after
// thousands of catches.
//
// The one rule that makes it transfer-proof: this only ever goes UP. Releasing,
// transferring or deleting a Box mon never decrements it, and importing a Box
// JSON never touches it (that would double-count).
//
// Stored under localStorage `pokemmo:catchlog`.

const LS_LOG = 'pokemmo:catchlog';
export const CATCHLOG_VERSION = 1;

export function emptyLog() {
  return {
    version: CATCHLOG_VERSION,
    total: 0,      // every catch, including repeats of the same species
    shiny: 0,
    alpha: 0,
    repeat: 0,     // catches of a species already logged before
    bySpecies: {}, // speciesId → count
    firstAt: null,
    lastAt: null,
  };
}

export function normalizeLog(obj) {
  const base = emptyLog();
  if (!obj || typeof obj !== 'object') return base;
  const bySpecies = {};
  for (const [k, v] of Object.entries(obj.bySpecies || {})) {
    const id = Number(k);
    const n = Math.max(0, Math.round(Number(v) || 0));
    if (Number.isFinite(id) && n > 0) bySpecies[id] = n;
  }
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  return {
    ...base,
    total: num(obj.total),
    shiny: num(obj.shiny),
    alpha: num(obj.alpha),
    repeat: num(obj.repeat),
    bySpecies,
    firstAt: typeof obj.firstAt === 'string' ? obj.firstAt : null,
    lastAt: typeof obj.lastAt === 'string' ? obj.lastAt : null,
  };
}

export function loadLog() {
  if (typeof window === 'undefined') return emptyLog();
  try { return normalizeLog(JSON.parse(localStorage.getItem(LS_LOG))); } catch { return emptyLog(); }
}

export function saveLog(log) {
  try { localStorage.setItem(LS_LOG, JSON.stringify(normalizeLog(log))); } catch { /* ignore */ }
}

// Add one catch. `mon` needs { species }, optionally { shiny, alpha }.
export function logCatch(log, mon) {
  if (mon?.species == null) return log;
  const id = Number(mon.species);
  if (!Number.isFinite(id)) return log;
  const had = log.bySpecies[id] || 0;
  const now = new Date().toISOString();
  return {
    ...log,
    total: log.total + 1,
    shiny: log.shiny + (mon.shiny ? 1 : 0),
    alpha: log.alpha + (mon.alpha ? 1 : 0),
    repeat: log.repeat + (had > 0 ? 1 : 0),
    bySpecies: { ...log.bySpecies, [id]: had + 1 },
    firstAt: log.firstAt || now,
    lastAt: now,
  };
}

export function logCatches(log, mons) {
  return (mons || []).reduce(logCatch, log);
}

// Species you've caught the most of, biggest first.
export function topSpecies(log, limit = 5) {
  return Object.entries(log.bySpecies)
    .map(([id, count]) => ({ species: Number(id), count }))
    .sort((a, b) => b.count - a.count || a.species - b.species)
    .slice(0, limit);
}

// The single most-caught species count — drives the "Dedicated" badge.
export function bestSpeciesCount(log) {
  const top = topSpecies(log, 1)[0];
  return top ? top.count : 0;
}
