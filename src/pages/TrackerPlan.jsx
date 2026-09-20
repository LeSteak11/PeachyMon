import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ChevronRight, Star, Check, X } from 'lucide-react';
import TypeBadge from '../components/TypeBadge.jsx';
import DexSearchInput from '../components/DexSearchInput.jsx';
import RarityBadge from '../components/RarityBadge.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import FilterRow from '../components/FilterRow.jsx';
import RegionPills from '../components/RegionPills.jsx';
import TypePills from '../components/TypePills.jsx';
import Modal from '../components/Modal.jsx';
import { typeColor } from '../lib/types.js';
import { dexNum } from '../lib/format.js';
import MethodIcon from '../components/MethodIcon.jsx';
import { parseLocation, regionRank } from '../lib/locations.js';
import { stateOf, scorePoints, cycleClick, trackerRarityRank, METHOD_OPTIONS, isExcludedFromTracker } from '../lib/tracker.js';
import {
  BABY_FILTERS, EVOLUTION_CATEGORIES,
  matchesTypes, matchesBaby, matchesEvolution, matchesTier,
} from '../lib/monFilters.js';

// Tracker-specific rarity order — same as TRACKER_RARITY_ORDER in tracker.js,
// duplicated here so the filter chips render in the right order without an
// extra export.
const RARITY_OPTIONS = ['Very Common', 'Common', 'Uncommon', 'Rare', 'Very Rare', 'Special', 'Horde', 'Lure'];

// Stable empty array (see TrackerMark) so an absent hunt-tier catalog doesn't
// bust the catalog memo each render.
const EMPTY = [];

export default function TrackerPlan({
  data, pokemonById,
  trackerState, setMonState,
  view, updateView,
  openPanel,
  // Location-modal open-key is lifted to Tracker so the "Full Pokédex entry"
  // flow can close it (avoids stacking the Plan modal under the detail modal).
  openKey, setOpenKey,
}) {
  const {
    planRegion, planMethods, planRarities = [], hideSingles,
    // Mon-attribute filters, shared with the Mark view (see monFilters.js).
    planTypes = [], planBaby = 'any', planEvolutions = [], planTiers = [],
  } = view;

  // Hunt-tier catalog (from pokemmo.json) drives the Hunt-tier filter row.
  const huntTierCatalog = data.hunt_tiers?.tiers || EMPTY;

  // ─────── Build per-location plan data ───────
  // For each (region, baseLocation) collect every encounter entry the
  // Pokémon has there. A single mon can show up under multiple methods or
  // rarities (e.g. a Horde and a Common spawn) — keep them all so the modal
  // can render them as multiple strips on the same card.
  const locationPlan = useMemo(() => {
    const groups = new Map(); // `${region}::${baseLower}` → entry
    for (const [key, monRefs] of Object.entries(data.locations)) {
      const [region, rawName] = key.split('::');
      const { base } = parseLocation(rawName);
      if (isExcludedFromTracker(base)) continue; // dex-gated locations
      const groupKey = `${region}::${base.toLowerCase()}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = { region, name: base, monMap: new Map(), methodSet: new Set(), _nameUpper: isAllUpper(base) };
        groups.set(groupKey, g);
      } else if (g._nameUpper && !isAllUpper(base)) {
        // Prefer the mixed-case variant for the display name.
        g.name = base; g._nameUpper = false;
      }
      for (const ref of monRefs) {
        g.methodSet.add(ref.method);
        const fullPokemon = pokemonById.get(ref.id);
        if (!fullPokemon) continue;
        // Pull every encounter entry for this mon at this base location
        // (across all time/season variants).
        const entriesHere = (fullPokemon.locations || []).filter(
          (l) => l.region === region && parseLocation(l.location).base.toLowerCase() === base.toLowerCase()
        );
        if (entriesHere.length === 0) continue;
        let me = g.monMap.get(ref.id);
        if (!me) {
          me = { pokemon: fullPokemon, entries: [], _seen: new Set() };
          g.monMap.set(ref.id, me);
        }
        // Dedupe identical strips (the dataset can record the same entry once
        // per seasonal variant key even when the visible details collapse).
        for (const e of entriesHere) {
          const stripKey = [e.method, e.rarity, e.min_level, e.max_level,
                            [...(parseLocation(e.location).times || [])].sort().join('|'),
                            [...(parseLocation(e.location).seasons || [])].sort().join('|')].join('::');
          if (me._seen.has(stripKey)) continue;
          me._seen.add(stripKey);
          me.entries.push(e);
        }
      }
    }
    // Strip helper fields and sort each mon's entries by tracker rarity rank.
    return [...groups.values()].map(({ _nameUpper, monMap, methodSet, ...rest }) => ({
      ...rest,
      monEntries: [...monMap.values()].map(({ _seen, entries, ...m }) => ({
        ...m,
        entries: entries.slice().sort((a, b) =>
          trackerRarityRank(a.rarity) - trackerRarityRank(b.rarity)
          || (a.min_level || 0) - (b.min_level || 0)
        ),
      })),
      methods: [...methodSet],
    }));
  }, [data.locations, pokemonById]);

  // Apply state + filters and compute scores. Keeping this separate from the
  // index so changing tracker state doesn't rebuild the index.
  const ranked = useMemo(() => {
    const out = [];
    // Mon-attribute filter sets — built once, applied per mon below. These are
    // the same gates the Mark grid uses (src/lib/monFilters.js), so the two
    // views stay consistent. null = filter off.
    const evoSet  = planEvolutions.length > 0 ? new Set(planEvolutions) : null;
    const tierSet = planTiers.length > 0 ? new Set(planTiers) : null;
    for (const loc of locationPlan) {
      if (planRegion !== 'All' && loc.region !== planRegion) continue;
      const methodAllowed = planMethods.length === 0
        ? null
        : new Set(planMethods);
      const rarityAllowed = planRarities.length === 0
        ? null
        : new Set(planRarities);

      let score = 0;
      let priorityScore = 0;
      let priorityCount = 0;
      const eligible = [];
      for (const me of loc.monEntries) {
        const state = stateOf(trackerState, me.pokemon.id);
        if (state === 'caught' || state === 'skipped') continue;
        // Mon-attribute gates (types / baby / evolution / hunt tier). A mon
        // that fails any active gate drops out of this location entirely.
        if (!matchesTypes(me.pokemon, planTypes)) continue;
        if (!matchesBaby(me.pokemon, planBaby)) continue;
        if (!matchesEvolution(me.pokemon, evoSet)) continue;
        if (!matchesTier(me.pokemon, tierSet)) continue;
        // Method + rarity filters: drop entries that don't match. A mon stays
        // eligible if at least one of its entries passes both filters.
        let visibleEntries = me.entries;
        if (methodAllowed) visibleEntries = visibleEntries.filter((e) => methodAllowed.has(e.method));
        if (rarityAllowed) visibleEntries = visibleEntries.filter((e) => rarityAllowed.has(e.rarity));
        if (visibleEntries.length === 0) continue;
        // Score from the best (lowest tracker rank) entry only — don't
        // double-count a mon listed under both a horde and a common.
        const bestEntry = visibleEntries.reduce((a, b) =>
          trackerRarityRank(b.rarity) < trackerRarityRank(a.rarity) ? b : a
        );
        const points = scorePoints(bestEntry.rarity, state);
        score += points;
        if (state === 'priority') {
          priorityScore += points;
          priorityCount += 1;
        }
        eligible.push({ pokemon: me.pokemon, entries: visibleEntries, bestEntry, state });
      }
      if (eligible.length === 0) continue;
      if (hideSingles && eligible.length < 2) continue;
      // Order mons by their best (lowest-rank) entry; dex id as tiebreaker.
      eligible.sort((a, b) =>
        trackerRarityRank(a.bestEntry.rarity) - trackerRarityRank(b.bestEntry.rarity)
        || a.pokemon.id - b.pokemon.id
      );
      out.push({
        region: loc.region,
        name: loc.name,
        methods: loc.methods,
        eligible,
        score,
        priorityScore,
        priorityCount,
      });
    }
    // Sort tiers, highest priority first:
    //   1. Locations with at least one priority mon, ranked among themselves
    //      by their priority-only score (using the base scoring algorithm,
    //      counting only priority mons).
    //   2. Locations without priority mons, ranked by overall score.
    //   3. Safari Zones always sink to the bottom regardless — Safari Balls,
    //      no battling, and mons flee, so they aren't a dependable dex farm.
    const isSafari = (loc) => /^safari zone$/i.test(loc.name);
    out.sort((a, b) => {
      const aS = isSafari(a), bS = isSafari(b);
      if (aS !== bS) return aS ? 1 : -1;
      const aP = a.priorityCount > 0, bP = b.priorityCount > 0;
      if (aP !== bP) return aP ? -1 : 1;
      if (aP) {
        return b.priorityScore - a.priorityScore
          || b.priorityCount - a.priorityCount
          || b.score - a.score
          || a.name.localeCompare(b.name, undefined, { numeric: true });
      }
      return b.score - a.score
        || b.eligible.length - a.eligible.length
        || a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return out;
  }, [locationPlan, trackerState, planRegion, planMethods, planRarities, hideSingles,
      planTypes, planBaby, planEvolutions, planTiers]);

  // ─────── Filter row handlers ───────
  const setRegion = useCallback((r) => updateView({ planRegion: r }), [updateView]);
  const setTypes  = useCallback((v) => updateView({ planTypes: v }), [updateView]);
  const setBaby   = useCallback((v) => updateView({ planBaby: v }), [updateView]);
  const toggleMethod = useCallback((m) => {
    updateView({ planMethods: planMethods.includes(m) ? planMethods.filter((x) => x !== m) : [...planMethods, m] });
  }, [planMethods, updateView]);
  const toggleRarity = useCallback((r) => {
    updateView({ planRarities: planRarities.includes(r) ? planRarities.filter((x) => x !== r) : [...planRarities, r] });
  }, [planRarities, updateView]);
  const toggleEvolution = useCallback((c) => {
    updateView({ planEvolutions: planEvolutions.includes(c) ? planEvolutions.filter((x) => x !== c) : [...planEvolutions, c] });
  }, [planEvolutions, updateView]);
  const toggleTier = useCallback((t) => {
    updateView({ planTiers: planTiers.includes(t) ? planTiers.filter((x) => x !== t) : [...planTiers, t] });
  }, [planTiers, updateView]);
  const toggleHideSingles = useCallback(() => updateView({ hideSingles: !hideSingles }), [hideSingles, updateView]);
  const resetFilters = useCallback(() => updateView({
    planRegion: 'All', planMethods: [], planRarities: [], hideSingles: true,
    planTypes: [], planBaby: 'any', planEvolutions: [], planTiers: [],
  }), [updateView]);

  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('score'); // score | count | name
  const activeFilterCount =
    (planRegion !== 'All' ? 1 : 0) + (planTypes.length ? 1 : 0) + (planMethods.length ? 1 : 0)
    + (planRarities.length ? 1 : 0) + (planBaby !== 'any' ? 1 : 0)
    + (planEvolutions.length ? 1 : 0) + (planTiers.length ? 1 : 0);
  /* ── "where do I catch X?" ── the search resolves to one species, then the
     location list narrows to the places it spawns, easiest first. ── */
  const searchMon = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const asNum = q.replace(/^#/, '');
    if (/^\d+$/.test(asNum)) return pokemonById.get(Number(asNum)) || null;
    const all = [...pokemonById.values()];
    return all.find((p) => p.name.toLowerCase() === q)
      || all.find((p) => p.name.toLowerCase().startsWith(q))
      || all.find((p) => p.name.toLowerCase().includes(q))
      || null;
  }, [search, pokemonById]);

  // Where that mon actually spawns (ignores the Plan's uncaught-only ranking,
  // so you can look up a mon you already have).
  const searchHits = useMemo(() => {
    if (!searchMon) return [];
    const out = [];
    for (const loc of locationPlan) {
      const me = loc.mons.find((m) => m.pokemon.id === searchMon.id);
      if (me) out.push({ loc, entries: me.entries });
    }
    return out.sort((a, b) => trackerRarityRank(a.entries[0]?.rarity) - trackerRarityRank(b.entries[0]?.rarity));
  }, [searchMon, locationPlan]);

  // Not catchable? Point at the closest pre-evolution that is.
  const searchSource = useMemo(() => {
    if (!searchMon || searchHits.length) return null;
    let cur = searchMon;
    const seen = new Set();
    while (cur?.pre_evolution != null && !seen.has(cur.id)) {
      seen.add(cur.id);
      const prev = pokemonById.get(cur.pre_evolution?.id ?? cur.pre_evolution);
      if (!prev) break;
      const where = locationPlan.filter((loc) => loc.mons.some((m) => m.pokemon.id === prev.id));
      if (where.length) return { mon: prev, locations: where.slice(0, 3) };
      cur = prev;
    }
    return null;
  }, [searchMon, searchHits, locationPlan, pokemonById]);

  const sorted = useMemo(() => {
    const list = [...ranked];
    if (sortBy === 'count') list.sort((a, b) => b.eligible.length - a.eligible.length || b.score - a.score);
    else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [ranked, sortBy]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      {/* What this page is, plus sort + the filter drawer */}
      <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100">Where to catch what you're missing</h2>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            Ranked by how much dex progress a trip is worth — common spawns score highest, hordes and lure-only spots lowest. Caught and skipped mons don't count.
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DexSearchInput
            className="flex-1 min-w-[200px]"
            value={search}
            onChange={setSearch}
            placeholder="Where do I catch… (name or dex #)"
          />
          <label className="text-xs text-stone-500 dark:text-stone-400">Sort</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm text-stone-900 dark:text-stone-100">
            <option value="score">Best value</option>
            <option value="count">Most new mons</option>
            <option value="name">A–Z</option>
          </select>
          <button type="button" onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md border text-xs ${
              activeFilterCount
                ? 'border-blue-300 text-blue-700 dark:border-blue-900 dark:text-blue-300'
                : 'border-[#d6c8a3] dark:border-stone-700 text-stone-600 dark:text-stone-300'}`}>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button type="button"
              onClick={() => updateView({ planRegion: 'All', planTypes: [], planMethods: [], planRarities: [], planBaby: 'any', planEvolutions: [], planTiers: [] })}
              className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 underline underline-offset-2">
              Clear
            </button>
          )}
          <span className="ml-auto text-xs text-stone-500 dark:text-stone-400 tabular-nums">
            {sorted.length} location{sorted.length === 1 ? '' : 's'}
          </span>
        </div>
        {showFilters && (<>
        <RegionPills value={planRegion} onChange={setRegion} />

        <TypePills value={planTypes} onChange={setTypes} />

        <FilterRow
          label="Method"
          options={METHOD_OPTIONS.map((m) => ({ key: m, label: m, icon: <MethodIcon method={m} size={12} /> }))}
          selected={planMethods}
          onToggle={toggleMethod}
          color="blue"
        />

        <FilterRow
          label="Rarity"
          options={RARITY_OPTIONS.map((r) => ({ key: r, label: r }))}
          selected={planRarities}
          onToggle={toggleRarity}
          color="blue"
        />

        {/* Babies — three-way single-select, shared with the Mark view. */}
        <FilterRow
          label="Babies"
          mode="single"
          options={BABY_FILTERS}
          selected={planBaby}
          onToggle={setBaby}
          color="pink"
        />

        {/* Evolution method — 8 buckets, OR semantics, family-aware. */}
        <FilterRow
          label="Evolution"
          options={EVOLUTION_CATEGORIES}
          selected={planEvolutions}
          onToggle={toggleEvolution}
          color="emerald"
          onClear={() => updateView({ planEvolutions: [] })}
        />

        {/* Hunt tier — only when the catalog is present (pokemmo.json). */}
        {huntTierCatalog.length > 0 && (
          <FilterRow
            label="Hunt tier"
            options={huntTierCatalog.map((t) => ({
              key: t.tier, label: `T${t.tier} ${t.label}`, title: t.blurb, color: t.color,
            }))}
            selected={planTiers}
            onToggle={toggleTier}
            onClear={() => updateView({ planTiers: [] })}
          />
        )}

        <div className="flex items-center gap-3 flex-wrap text-xs">
          <label className="inline-flex items-center gap-1.5 text-stone-700 dark:text-stone-300 cursor-pointer">
            <input
              type="checkbox"
              checked={hideSingles}
              onChange={toggleHideSingles}
              className="accent-blue-500"
            />
            Hide single-mon locations
          </label>
          <span className="ml-auto text-stone-500 dark:text-stone-400 tabular-nums">
            {ranked.length} location{ranked.length === 1 ? '' : 's'}
          </span>
        </div>
        </>)}
      </section>

      {/* Search answer — one mon, every place it spawns, easiest first */}
      {searchMon && (
        <section className="rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/25 p-3">
          <div className="flex items-center gap-3">
            <PokemonSprite pokemon={searchMon} variant="animated" className="w-12 h-12 object-contain shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-stone-900 dark:text-stone-100">{searchMon.name}</div>
              <div className="text-xs text-stone-600 dark:text-stone-400">
                {searchHits.length > 0
                  ? `Spawns in ${searchHits.length} location${searchHits.length === 1 ? '' : 's'} · easiest: ${searchHits[0].loc.name} (${searchHits[0].entries[0]?.rarity || 'unknown'})`
                  : searchSource
                    ? `Not catchable in the wild — catch ${searchSource.mon.name} and evolve it.`
                    : 'Not catchable in the wild.'}
              </div>
            </div>
            <button type="button" onClick={() => setSearch('')}
              className="ml-auto text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 underline underline-offset-2">
              Clear search
            </button>
          </div>
          {searchHits.length === 0 && searchSource && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {searchSource.locations.map((loc) => (
                <button key={`${loc.region}::${loc.name}`} type="button" onClick={() => setOpenKey(`${loc.region}::${loc.name}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 px-2 py-1 text-xs hover:bg-[#ece2c4] dark:hover:bg-stone-800">
                  <PokemonSprite pokemon={searchSource.mon} variant="still" className="w-4 h-4 object-contain" />
                  {loc.name} <span className="text-stone-500">({loc.region})</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Search results: every spawn of that mon, easiest first */}
      {searchMon && searchHits.length > 0 && (
        <div className="space-y-1.5">
          {searchHits.map(({ loc, entries }) => (
            <button key={`${loc.region}::${loc.name}`} type="button" onClick={() => setOpenKey(`${loc.region}::${loc.name}`)}
              className="w-full flex items-center gap-3 text-left rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 hover:border-blue-400 dark:hover:border-blue-700 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{loc.region}</div>
                <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">{loc.name}</div>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-end text-[11px] text-stone-600 dark:text-stone-400 max-w-[60%]">
                {entries.map((e, i) => (
                  <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
                    <MethodIcon method={e.method} size={12} />
                    {e.rarity}
                    {e.min_level != null && <span className="text-stone-500">Lv {e.min_level}{e.max_level != null && e.max_level !== e.min_level ? `–${e.max_level}` : ''}</span>}
                  </span>
                ))}
              </div>
              <ChevronRight size={16} className="shrink-0 text-stone-400" />
            </button>
          ))}
        </div>
      )}

      {/* Location cards — the normal ranking, hidden while searching */}
      {searchMon ? null : sorted.length === 0 ? (
        <div className="py-16 text-center text-stone-500 dark:text-stone-400 text-sm">
          No locations have catchable mons under your current filters.
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((loc) => (
            <PlanLocationCard
              key={`${loc.region}::${loc.name}`}
              loc={loc}
              onOpen={setOpenKey}
            />
          ))}
        </div>
      )}

      {openKey && (() => {
        // Search results can point at a location the ranking filtered out
        // (everything there is already caught, say), so fall back to the raw
        // index and show every mon that lives there.
        let loc = ranked.find((l) => `${l.region}::${l.name}` === openKey);
        if (!loc) {
          const raw = locationPlan.find((l) => `${l.region}::${l.name}` === openKey);
          if (raw) {
            loc = {
              region: raw.region, name: raw.name, methods: raw.methods,
              eligible: raw.mons, score: 0, priorityScore: 0, priorityCount: 0,
            };
          }
        }
        if (!loc) { setOpenKey(null); return null; }
        return (
          <PlanLocationModal
            loc={loc}
            trackerState={trackerState}
            setMonState={setMonState}
            openPanel={openPanel}
            onClose={() => setOpenKey(null)}
          />
        );
      })()}
    </main>
  );
}

function isAllUpper(s) { return s.length > 0 && s === s.toUpperCase() && s !== s.toLowerCase(); }

/* ─────────────── Plan location card ─────────────── */

// A summary card. Clicking it opens the modal that lists the location's
// catchable mons. We pass `loc` for display and a stable `onOpen(key)` setter
// so the modal binds to the live ranked entry by key.
const PlanLocationCard = memo(function PlanLocationCard({ loc, onOpen }) {
  const key = `${loc.region}::${loc.name}`;
  const hasPriority = loc.priorityCount > 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(key)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg
                 border transition-all duration-150 hover:shadow-md
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                 ${hasPriority
                   ? 'border-amber-400 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 hover:border-amber-500 dark:hover:border-amber-600'
                   : 'border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 hover:border-[#c4b486] dark:hover:border-stone-600'}`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{loc.region}</div>
        <div className="font-semibold text-stone-900 dark:text-stone-100 truncate flex items-center gap-1.5">
          {hasPriority && <Star size={12} fill="currentColor" className="text-amber-500 shrink-0" />}
          {loc.name}
        </div>
      </div>
      <div className="hidden sm:flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-stone-600 dark:text-stone-400 max-w-[260px] justify-end">
        {loc.methods.map((m) => (
          <span key={m} className="inline-flex items-center gap-1"><MethodIcon method={m} size={12} />{m}</span>
        ))}
      </div>
      <div className="shrink-0 flex items-center gap-2 ml-2">
        <span
          title="Pokémon here you haven't caught yet"
          className="inline-flex items-baseline gap-1 rounded-full bg-blue-500/10 text-blue-800 dark:text-blue-300 px-2 py-0.5 tabular-nums"
        >
          <span className="font-bold text-sm leading-none">{loc.eligible.length}</span>
          <span className="text-[10px]">new</span>
        </span>
        <div className="flex flex-col items-end">
          {hasPriority && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">★{loc.priorityCount} priority</span>
          )}
          <span className="text-[10px] text-stone-500 dark:text-stone-400 tabular-nums" title="Trip value — rarer catches are worth less because they take longer">
            value {loc.score}
          </span>
        </div>
      </div>
      <ChevronRight size={16} className="shrink-0 text-stone-400 ml-1" />
    </button>
  );
});

/* ─────────────── Plan location modal ─────────────── */

function PlanLocationModal({ loc, trackerState, setMonState, openPanel, onClose }) {
  return (
    <Modal
      onClose={onClose}
      z="z-40"
      maxWidth="max-w-2xl"
      maxHeight="min(720px, calc(100vh - 3rem))"
      showClose={false}
      ariaLabel={`${loc.name} catch plan`}
      header={
        <div className="p-4 border-b border-[#e6dabf] dark:border-stone-800 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{loc.region}</div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 truncate">{loc.name}</h2>
              <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                {loc.eligible.length} mon{loc.eligible.length === 1 ? '' : 's'} you still need
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-end">
              <div className="text-[10px] text-stone-500 dark:text-stone-400" title="Trip value — rarer catches are worth less because they take longer">Trip value</div>
              <div className="font-bold text-stone-900 dark:text-stone-100 tabular-nums text-2xl leading-none">{loc.score}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md bg-[#fdf8e9] dark:bg-stone-800 hover:bg-[#ece2c4] dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
      }
    >
      <div className="p-3 space-y-1.5">
        {loc.eligible.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-500 dark:text-stone-400">
            Everything here is caught. Close to find the next location.
          </div>
        ) : (
          loc.eligible.map((m) => (
            <PlanMonRow
              key={m.pokemon.id}
              pokemon={m.pokemon}
              entries={m.entries}
              state={m.state}
              setMonState={setMonState}
              openPanel={openPanel}
              currentRegion={loc.region}
              currentLocation={loc.name}
            />
          ))
        )}
      </div>
    </Modal>
  );
}

/* ─────────────── Plan mon row (interactive) ─────────────── */

const PlanMonRow = memo(function PlanMonRow({ pokemon: p, entries, state, setMonState, openPanel, currentRegion, currentLocation }) {
  const primary = typeColor(p.types[0]).bg;
  const longPress = useLongPress(() => openPanel(p.id));
  const better = findBetterLocation(p, currentRegion, currentLocation);

  function onClick(e) {
    if (e.shiftKey) return;
    setMonState(p.id, cycleClick(state));
  }
  function onContextMenu(e) {
    e.preventDefault();
    openPanel(p.id);
  }

  const isPriority = state === 'priority';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } }}
      {...longPress}
      className={`group flex items-start gap-3 px-2 py-1.5 rounded cursor-pointer
                  border ${isPriority ? 'border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20' : 'border-transparent hover:bg-[#ece2c4]/60 dark:hover:bg-stone-800/30'}
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      <div
        className="relative shrink-0 w-10 h-10 rounded overflow-hidden flex items-center justify-center"
        style={{ background: `radial-gradient(circle at 50% 50%, ${primary}26 0%, ${primary}14 70%, ${primary}0a 100%)` }}
      >
        <PokemonSprite pokemon={p} variant="animated" loading="lazy" className="w-9 h-9 object-contain" />
        {isPriority && (
          <Star size={10} fill="currentColor" className="absolute top-0 right-0 text-amber-500 drop-shadow" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] text-stone-500">{dexNum(p.id)}</span>
          <span className="font-semibold text-sm text-stone-900 dark:text-stone-100 truncate">{p.name}</span>
          <div className="flex gap-1">
            {[...new Set(p.types)].map((t) => <TypeBadge key={t} type={t} />)}
          </div>
        </div>
        <div className="mt-1 space-y-0.5">
          {entries.map((entry, i) => <PlanEncounterStrip key={i} entry={entry} />)}
        </div>
        {better && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400" title={`Best rate for ${p.name} is at ${better.base} (${better.region}) — ${better.rarity}.`}>
            <ChevronRight size={11} className="shrink-0" />
            <span>Better at <span className="font-semibold">{better.base}</span> <span className="text-stone-500 dark:text-stone-400">({better.region})</span> · {better.rarity}</span>
          </div>
        )}
      </div>

      <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-stone-400 dark:text-stone-500 shrink-0 opacity-0 group-hover:opacity-100 mt-1">
        <Check size={10} /> click = caught
      </span>
    </div>
  );
});

// For a Pokémon listed at (currentRegion, currentLocation): does it have a
// HIGHER-weight (easier) encounter at any OTHER location? If yes, return the
// best such alternative; if the current location is already its best (or only)
// spot, return null.
function findBetterLocation(pokemon, currentRegion, currentLocation) {
  const all = pokemon.locations || [];
  if (all.length <= 1) return null;
  const curBase = (currentLocation || '').toLowerCase();
  let bestHere = 0;
  let bestElsewhere = null;
  for (const loc of all) {
    const base = parseLocation(loc.location).base;
    const isHere = loc.region === currentRegion && base.toLowerCase() === curBase;
    if (isHere) {
      if ((loc.weight || 0) > bestHere) bestHere = loc.weight || 0;
    } else {
      // Don't suggest dex-gated locations as alternatives.
      if (isExcludedFromTracker(base)) continue;
      if (!bestElsewhere || (loc.weight || 0) > bestElsewhere.weight) {
        bestElsewhere = {
          weight: loc.weight || 0,
          region: loc.region,
          base,
          rarity: loc.rarity,
        };
      }
    }
  }
  if (!bestElsewhere || bestElsewhere.weight <= bestHere) return null;
  return bestElsewhere;
}

function PlanEncounterStrip({ entry }) {
  const lvl = entry.min_level === entry.max_level
    ? `Lv ${entry.min_level}`
    : `Lv ${entry.min_level}–${entry.max_level}`;
  const parsed = parseLocation(entry.location);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 text-stone-700 dark:text-stone-300">
        <MethodIcon method={entry.method} size={12} />{entry.method}
      </span>
      <RarityBadge rarity={entry.rarity} />
      <span className="font-mono tabular-nums text-stone-700 dark:text-stone-300">{lvl}</span>
      {parsed.times.length > 0 && (
        <span className="text-stone-500 dark:text-stone-400">{parsed.times.join(' · ')}</span>
      )}
      {parsed.seasons.length > 0 && (
        <span className="text-stone-500 dark:text-stone-400">S{parsed.seasons.join(',')}</span>
      )}
    </div>
  );
}

// Long-press helper for touch devices. Returns props you spread on the element.
function useLongPress(onLongPress, ms = 500) {
  const timer = useRef(null);
  const triggered = useRef(false);
  const start = useCallback((e) => {
    triggered.current = false;
    timer.current = setTimeout(() => {
      triggered.current = true;
      onLongPress(e);
    }, ms);
  }, [onLongPress, ms]);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onTouchCancel: cancel,
  };
}
