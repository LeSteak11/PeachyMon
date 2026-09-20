// Tracker badges — completionist goals derived from the tracker state, plus a
// tiny localStorage record of WHEN each was first earned (the state itself
// stays a plain id→state map, so progress is always recomputed from scratch).
//
// Every badge is { id, group, name, blurb, have, need, done, tier }.
// `tier` drives the medal colour: bronze | silver | gold | platinum | special.

const LS_BADGES = 'pokemmo:badges';

export const BADGE_GROUPS = [
  { key: 'milestone', label: 'Milestones' },
  { key: 'region', label: 'Regions' },
  { key: 'type', label: 'Type masters' },
  { key: 'collection', label: 'Collections' },
  { key: 'catch', label: 'Catching' },
];

const REGION_LABEL = {
  kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh', unova: 'Unova',
};
const REGION_KEYS = Object.keys(REGION_LABEL);
const MILESTONES = [10, 50, 100, 250, 500];
const REGION_MEDALS = [
  { pct: 25, tier: 'bronze', label: 'Bronze' },
  { pct: 50, tier: 'silver', label: 'Silver' },
  { pct: 90, tier: 'gold', label: 'Gold' },
  { pct: 100, tier: 'platinum', label: 'Platinum' },
];

const caughtIds = (trackerState) =>
  new Set(Object.entries(trackerState || {}).filter(([, v]) => v === 'caught').map(([k]) => Number(k)));

// Per-region / per-type / per-flag tallies used by every badge below.
export function trackerStats(pokemon, trackerState) {
  const caught = caughtIds(trackerState);
  const isCaught = (p) => caught.has(p.id);

  const regions = REGION_KEYS.map((key) => {
    const list = pokemon.filter((p) => (p.dex?.[key] || 0) > 0);
    return { key, label: REGION_LABEL[key], total: list.length, have: list.filter(isCaught).length };
  });

  const typeMap = new Map();
  for (const p of pokemon) {
    for (const t of p.types || []) {
      if (!typeMap.has(t)) typeMap.set(t, { type: t, total: 0, have: 0 });
      const row = typeMap.get(t);
      row.total += 1;
      if (isCaught(p)) row.have += 1;
    }
  }
  const types = [...typeMap.values()].sort((a, b) => b.total - a.total);

  // Evolution families: every mon reachable from a root (a mon with no
  // pre-evolution). A family counts as complete when all its members are caught.
  const byId = new Map(pokemon.map((p) => [p.id, p]));
  const members = (root) => {
    const out = [];
    const walk = (id, seen = new Set()) => {
      if (seen.has(id)) return;
      seen.add(id);
      const p = byId.get(id);
      if (!p) return;
      out.push(p);
      for (const e of p.evolutions || []) walk(e.id, seen);
    };
    walk(root.id);
    return out;
  };
  const families = pokemon.filter((p) => !p.pre_evolution).map(members);
  const familiesDone = families.filter((f) => f.every(isCaught)).length;

  const flagged = (fn) => {
    const list = pokemon.filter(fn);
    return { total: list.length, have: list.filter(isCaught).length };
  };

  return {
    caught: caught.size,
    total: pokemon.length,
    regions,
    types,
    families: { total: families.length, have: familiesDone },
    legendary: flagged((p) => p.is_legendary),
    mythical: flagged((p) => p.is_mythical),
    baby: flagged((p) => p.is_baby),
  };
}

export function buildBadges(pokemon, trackerState, log = null) {
  const s = trackerStats(pokemon, trackerState);
  const out = [];
  const add = (b) => out.push({ ...b, done: b.have >= b.need });

  for (const n of MILESTONES) {
    add({
      id: `milestone-${n}`, group: 'milestone', tier: n >= 500 ? 'gold' : n >= 100 ? 'silver' : 'bronze',
      name: `${n} caught`, blurb: `Catch ${n} different Pokémon.`, have: Math.min(s.caught, n), need: n,
    });
  }
  add({
    id: 'milestone-all', group: 'milestone', tier: 'platinum', name: 'Living dex',
    blurb: `Catch all ${s.total} Pokémon in PokéMMO.`, have: s.caught, need: s.total,
  });

  for (const r of s.regions) {
    for (const m of REGION_MEDALS) {
      const need = Math.ceil((r.total * m.pct) / 100);
      add({
        id: `region-${r.key}-${m.pct}`, group: 'region', tier: m.tier,
        name: `${r.label} ${m.label}`,
        blurb: m.pct === 100 ? `Complete the ${r.label} dex (${r.total}).` : `Catch ${m.pct}% of the ${r.label} dex (${need} of ${r.total}).`,
        have: Math.min(r.have, need), need,
      });
    }
  }

  for (const t of s.types) {
    add({
      id: `type-${t.type.toLowerCase()}`, group: 'type', tier: 'gold',
      name: `${t.type} master`, blurb: `Catch every ${t.type}-type Pokémon (${t.total}).`,
      have: t.have, need: t.total,
    });
  }

  add({ id: 'family-10', group: 'collection', tier: 'bronze', name: 'Family album', blurb: 'Complete 10 evolution families.', have: Math.min(s.families.have, 10), need: 10 });
  add({ id: 'family-50', group: 'collection', tier: 'silver', name: 'Family historian', blurb: 'Complete 50 evolution families.', have: Math.min(s.families.have, 50), need: 50 });
  add({ id: 'family-all', group: 'collection', tier: 'platinum', name: 'Every branch', blurb: `Complete all ${s.families.total} evolution families.`, have: s.families.have, need: s.families.total });
  add({ id: 'legendary', group: 'collection', tier: 'gold', name: 'Legend hunter', blurb: `Catch all ${s.legendary.total} legendary Pokémon.`, have: s.legendary.have, need: s.legendary.total });
  add({ id: 'mythical', group: 'collection', tier: 'gold', name: 'Mythmaker', blurb: `Catch all ${s.mythical.total} mythical Pokémon.`, have: s.mythical.have, need: s.mythical.total });
  add({ id: 'baby', group: 'collection', tier: 'silver', name: 'Nursery', blurb: `Catch all ${s.baby.total} baby Pokémon.`, have: s.baby.have, need: s.baby.total });

  // Volume badges come from the catch log (every catch ever, transfers
  // included), not from what's currently in the Box.
  if (log) {
    const best = Object.values(log.bySpecies || {}).reduce((n, v) => Math.max(n, v), 0);
    for (const n of [25, 100, 500, 1000, 5000]) {
      add({
        id: `catch-${n}`, group: 'catch',
        tier: n >= 5000 ? 'platinum' : n >= 1000 ? 'gold' : n >= 100 ? 'silver' : 'bronze',
        name: `${n.toLocaleString()} catches`, blurb: `Catch ${n.toLocaleString()} Pokémon in total (repeats count).`,
        have: Math.min(log.total, n), need: n,
      });
    }
    for (const n of [1, 5, 25]) {
      add({
        id: `shiny-${n}`, group: 'catch', tier: n >= 25 ? 'platinum' : n >= 5 ? 'gold' : 'silver',
        name: n === 1 ? 'First shiny' : `${n} shinies`, blurb: `Catch ${n} shiny Pokémon.`,
        have: Math.min(log.shiny, n), need: n,
      });
    }
    for (const n of [1, 10]) {
      add({
        id: `alpha-${n}`, group: 'catch', tier: n >= 10 ? 'gold' : 'silver',
        name: n === 1 ? 'First alpha' : `${n} alphas`, blurb: `Catch ${n} alpha Pokémon.`,
        have: Math.min(log.alpha, n), need: n,
      });
    }
    add({
      id: 'catch-dedicated', group: 'catch', tier: 'gold', name: 'Dedicated',
      blurb: 'Catch 50 of the same species.', have: Math.min(best, 50), need: 50,
    });
    add({
      id: 'catch-grinder', group: 'catch', tier: 'silver', name: 'Grinder',
      blurb: 'Catch 100 Pokémon of species you had already caught before.',
      have: Math.min(log.repeat, 100), need: 100,
    });
  }

  return { stats: s, badges: out };
}

/* ── first-earned dates (localStorage only; safe to lose) ── */

export function loadEarned() {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(LS_BADGES)) || {}; } catch { return {}; }
}

// Stamps any newly finished badge with today's date. Returns { earned, fresh }
// where `fresh` lists the ids earned by this call (for a toast).
export function syncEarned(badges, prev = loadEarned()) {
  const earned = { ...prev };
  const fresh = [];
  for (const b of badges) {
    if (b.done && !earned[b.id]) { earned[b.id] = new Date().toISOString(); fresh.push(b.id); }
  }
  if (fresh.length && typeof window !== 'undefined') {
    try { localStorage.setItem(LS_BADGES, JSON.stringify(earned)); } catch { /* ignore */ }
  }
  return { earned, fresh };
}
