// IV grading — scores a Box mon 0–100 for how good its IVs are *for that
// species*, not by raw IV total. A 31 in a stat the mon never uses is worth
// nothing; two 31s in the right places beat four in the wrong ones.
//
// 1. Weights come from the species' base stats: the attacking stat it doesn't
//    use is worth ZERO, its two best stats carry two thirds of the score, and
//    the rest share the remainder (Speed keeps a small floor).
// 2. Score = weighted average of IV/31.
// 3. Nature adjusts by up to ±10: boosting a stat that matters helps, boosting
//    the dump stat hurts, lowering the dump stat is ideal.
//
// Trick Room (where low Speed is wanted) is NOT modelled.

import { NATURES, BASE_KEY } from './teamAnalysis.js';

export const GRADE_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

const KEY_SHARE = 0.66;    // the two stats the species is built around
const SPEED_FLOOR = 0.12;  // Speed still matters even on a slow mon

// Base stats alone would crown HP on almost everything (base HP runs high), so
// each stat is scaled by how much a competitive build leans on it before the
// two "key" stats are picked and weighted.
const ROLE_MULT = { hp: 0.85, atk: 1.25, def: 0.9, spa: 1.25, spd: 0.9, spe: 1.2 };

// Per-stat weights (summing to 1) for a species:
//  · the attacking stat it doesn't use is worth ZERO;
//  · its two best base stats ("key stats") carry two thirds between them;
//  · the rest share the last third.
// So Garchomp is graded on Atk/Spe, Blissey on HP/SpD, and a 31 in the wrong
// place barely moves the score.
export function statWeights(species) {
  const base = {};
  for (const k of GRADE_KEYS) base[k] = Number(species?.stats?.[BASE_KEY[k]]) || 0;
  const physical = base.atk >= base.spa;
  const unused = physical ? 'spa' : 'atk';

  const adj = {};
  for (const k of GRADE_KEYS) adj[k] = base[k] * ROLE_MULT[k];

  const used = GRADE_KEYS.filter((k) => k !== unused);
  const ranked = [...used].sort((x, y) => adj[y] - adj[x]);
  const key = ranked.slice(0, 2);
  const rest = ranked.slice(2);

  const share = (group, total) => {
    const sum = group.reduce((n, k) => n + adj[k], 0) || 1;
    return Object.fromEntries(group.map((k) => [k, total * (adj[k] / sum)]));
  };
  const w = { [unused]: 0, ...share(key, KEY_SHARE), ...share(rest, 1 - KEY_SHARE) };

  if (w.spe < SPEED_FLOOR) {
    const pool = 1 - w.spe;
    const want = 1 - SPEED_FLOOR;
    for (const k of GRADE_KEYS) if (k !== 'spe') w[k] = pool ? (w[k] / pool) * want : 0;
    w.spe = SPEED_FLOOR;
  }
  return { weights: w, unused, physical, key };
}

export function letterFor(score) {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

// Returns null when there's nothing to grade yet (no species, or no IVs
// entered at all — all zeroes means "not captured", not "terrible").
export function gradeMon(mon, species) {
  if (!species || !mon?.ivs) return null;
  const ivs = {};
  for (const k of GRADE_KEYS) ivs[k] = Math.min(31, Math.max(0, Number(mon.ivs[k]) || 0));
  if (GRADE_KEYS.every((k) => ivs[k] === 0)) return null;

  const { weights, unused, physical, key } = statWeights(species);
  const raw = GRADE_KEYS.reduce((n, k) => n + weights[k] * (ivs[k] / 31), 0) * 100;

  // The stats that carry the score.
  const used = GRADE_KEYS.filter((k) => k !== unused);
  const matters = (k) => key.includes(k);

  const nat = NATURES[mon.nature] || {};
  let natureAdj = 0;
  const notes = [];
  if (nat.plus && nat.minus) {
    if (nat.plus === unused) { natureAdj -= 6; notes.push(`${mon.nature} boosts ${LABEL[nat.plus]}, which it doesn't use (−6)`); }
    else if (matters(nat.plus)) { natureAdj += 6; notes.push(`${mon.nature} boosts ${LABEL[nat.plus]} (+6)`); }
    else { natureAdj += 2; notes.push(`${mon.nature} boosts ${LABEL[nat.plus]} (+2)`); }

    if (nat.minus === unused) { natureAdj += 4; notes.push(`and lowers ${LABEL[nat.minus]}, its dump stat (+4)`); }
    else if (matters(nat.minus)) { natureAdj -= 8; notes.push(`but lowers ${LABEL[nat.minus]} (−8)`); }
    else { natureAdj -= 3; notes.push(`and lowers ${LABEL[nat.minus]} (−3)`); }
  } else if (mon.nature) {
    notes.push(`${mon.nature} is a neutral nature`);
  }

  const score = Math.round(Math.min(100, Math.max(0, raw + natureAdj)));

  // One line: the role, the stats that carry the score, and the nature.
  const ordered = [...key].sort((a, b) => weights[b] - weights[a]);
  const hits = ordered.map((k) => `${LABEL[k]} ${ivs[k]}`).join(', ');
  const reason = [
    `Graded on ${hits}`,
    `${LABEL[unused]} ignored`,
    ...notes,
  ].join('. ') + '.';

  return {
    score,
    letter: letterFor(score),
    reason,
    weights,
    unused,
    physical,
    keyStats: ordered,
    natureAdj,
    perfectKey: ordered.filter((k) => ivs[k] === 31).length,
  };
}
