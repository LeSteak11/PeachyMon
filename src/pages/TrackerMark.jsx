import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Check, Slash, Star, X } from 'lucide-react';
import FilterRow from '../components/FilterRow.jsx';
import RegionPills from '../components/RegionPills.jsx';
import DexSearchInput from '../components/DexSearchInput.jsx';
import TypePills from '../components/TypePills.jsx';
import { PokemonCardBody } from '../components/PokemonCard.jsx';
import { regionKey, statTotal } from '../lib/format.js';
import TrackerProgress from '../components/TrackerProgress.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import { stateOf, cycleClick } from '../lib/tracker.js';
import {
  BABY_FILTERS, EVOLUTION_CATEGORIES,
  matchesTypes, matchesBaby, matchesEvolution, matchesTier,
} from '../lib/monFilters.js';

// Stable empty array so `data.hunt_tiers?.tiers || EMPTY` returns the same
// reference when the catalog is absent — a fresh `[]` each render would bust
// the huntTierByNum useMemo below.
const EMPTY = [];
const SORTS = [
  { value: 'dex',  label: 'Dex #' },
  { value: 'name', label: 'Name A→Z' },
  { value: 'bst',  label: 'BST high→low' },
  // Hunt priority — tier 0 first, then 1, 2, (4=default), 5. Tier-tagged
  // mons cluster at the top with tier 4 (everything unassigned) trailing.
  { value: 'tier', label: 'Hunt priority' },
];

// Per-tier visual styling. Keys match `data.hunt_tiers.tiers[].color`.
// Kept here rather than in pokemmo.json so Tailwind's purge can statically
// see every class string at build time.
const TIER_STYLE = {
  rose:    { active: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',          badge: 'bg-rose-500 text-white'       },
  amber:   { active: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',    badge: 'bg-amber-500 text-white'     },
  violet:  { active: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900', badge: 'bg-violet-500 text-white' },
  emerald: { active: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900', badge: 'bg-emerald-500 text-white' },
  stone:   { active: 'bg-stone-200 text-stone-800 border-stone-400 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-600',       badge: 'bg-stone-500 text-white'     },
};
const STATE_FILTERS = [
  { key: 'uncaught', label: 'Uncaught' },
  { key: 'caught',   label: 'Caught'   },
  { key: 'priority', label: 'Priority' },
  { key: 'skipped',  label: 'Skipped'  },
];
// Rarity filter — ordered roughly from most to least common, with the
// encounter-flavor rarities (Horde / Lure / Special) trailing. Matches the
// strings build-data.mjs emits as `loc.rarity`. See:
//   node -e 'r = new Set(); require("./src/data/pokemmo.json").pokemon
//     .forEach(p=>p.locations?.forEach(l=>r.add(l.rarity))); console.log([...r])'
const RARITY_FILTERS = [
  'Very Common', 'Common', 'Uncommon', 'Rare', 'Very Rare', 'Horde', 'Lure', 'Special',
];

export default function TrackerMark({
  data,
  trackerState, setMonState, setManyMonStates,
  view, updateView,
  openPanel,
  catchLog, onLogCatch,
}) {
  const {
    markSearch, markRegion, markTypes, markStates, markSort,
    markBaby = 'any',
    markRarities = [],
    markRaritiesMode = 'only',
    markEvolutions = [],
    markTiers = [],
  } = view;
  // Hunt-tier catalog ships in pokemmo.json. Tracker UI degrades gracefully
  // to no tier filter if the field is absent (older builds, or a future rev
  // that drops the file).
  const huntTierCatalog = data.hunt_tiers?.tiers || EMPTY;
  const huntTierByNum = useMemo(() => {
    const m = new Map();
    for (const t of huntTierCatalog) m.set(t.tier, t);
    return m;
  }, [huntTierCatalog]);
  const deferredSearch = useDeferredValue(markSearch);

  const setSearch = useCallback((v) => updateView({ markSearch: v }),  [updateView]);
  const setRegion = useCallback((v) => updateView({ markRegion: v }),  [updateView]);
  const setSort   = useCallback((v) => updateView({ markSort:   v }),  [updateView]);
  const setBaby   = useCallback((v) => updateView({ markBaby:   v }),  [updateView]);
  const setRaritiesMode = useCallback((v) => updateView({ markRaritiesMode: v }), [updateView]);
  const setTypes  = useCallback((v) => updateView({ markTypes: v }), [updateView]);
  const toggleStateFilter = useCallback((s) => {
    updateView({ markStates: markStates.includes(s) ? markStates.filter((x) => x !== s) : [...markStates, s] });
  }, [markStates, updateView]);
  const toggleRarityFilter = useCallback((r) => {
    updateView({ markRarities: markRarities.includes(r) ? markRarities.filter((x) => x !== r) : [...markRarities, r] });
  }, [markRarities, updateView]);
  const toggleEvolutionFilter = useCallback((c) => {
    updateView({ markEvolutions: markEvolutions.includes(c) ? markEvolutions.filter((x) => x !== c) : [...markEvolutions, c] });
  }, [markEvolutions, updateView]);
  const toggleTierFilter = useCallback((t) => {
    updateView({ markTiers: markTiers.includes(t) ? markTiers.filter((x) => x !== t) : [...markTiers, t] });
  }, [markTiers, updateView]);

  // ─────── Evolution-family index ───────
  // Map<pokemonId, Set<pokemonId>> — for every Pokémon, the set of every
  // member of its evolution family (pre-evolutions, post-evolutions, and all
  // branches). Handles linear chains (Bulbasaur → Ivysaur → Venusaur),
  // branching post-evolutions (Eevee → 8 eeveelutions), and mid-chain
  // branches (Wurmple → Silcoon/Cascoon → Beautifly/Dustox).
  //
  // Why this exists: searching by name in the Mark grid surfaces only the
  // typed mon, which hides the fact that completing a regional dex often
  // requires breeding or evolving from a different listed mon. Expanding the
  // result to the whole family lets the user see at a glance whether they
  // already have the relevant pre-/post-evos marked.
  //
  // Built once per data.pokemon load via BFS over `evolutions[].id` and
  // `pre_evolution.id`. Connected components share their Set instance so
  // membership lookup is O(1) per filter iteration.
  const familyMap = useMemo(() => {
    const byId = new Map(data.pokemon.map((p) => [p.id, p]));
    const families = new Map();
    const visited = new Set();
    for (const root of data.pokemon) {
      if (visited.has(root.id)) continue;
      const family = new Set();
      const stack = [root.id];
      while (stack.length) {
        const cur = stack.pop();
        if (family.has(cur)) continue;
        family.add(cur);
        const mon = byId.get(cur);
        if (!mon) continue;
        if (mon.pre_evolution?.id != null) stack.push(mon.pre_evolution.id);
        for (const ev of (mon.evolutions || [])) {
          if (ev?.id != null) stack.push(ev.id);
        }
      }
      for (const id of family) {
        families.set(id, family);
        visited.add(id);
      }
    }
    return families;
  }, [data.pokemon]);

  // ─────── Filter pipeline ───────
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let dexQuery = null;
    if (q) {
      const m = q.replace(/^#/, '').match(/^\d+$/);
      if (m) dexQuery = parseInt(m[0], 10);
    }
    const rkey = regionKey(markRegion);
    const stateSet = markStates.length > 0 ? new Set(markStates) : null;

    // When the user typed a search, first find every mon that matches it
    // DIRECTLY, then expand to those mons' evolution families. The family
    // expansion is the user-visible behavior change — it makes the Mark
    // grid show e.g. Bulbasaur + Ivysaur + Venusaur when you search "bulb",
    // so the user can see at a glance whether the evolved forms are already
    // tracked. Region / type / state filters still apply on top.
    //
    // searchFamilyIds === null means "no search active, skip this check".
    let searchFamilyIds = null;
    if (q) {
      searchFamilyIds = new Set();
      for (const p of data.pokemon) {
        const nameMatch = p.name.toLowerCase().includes(q);
        const nationalMatch = dexQuery != null && p.id === dexQuery;
        const regionalMatch = dexQuery != null && rkey && p.dex?.[rkey] === dexQuery;
        if (!nameMatch && !nationalMatch && !regionalMatch) continue;
        const fam = familyMap.get(p.id);
        if (fam) for (const id of fam) searchFamilyIds.add(id);
        else searchFamilyIds.add(p.id);
      }
    }

    // Pre-bake the rarity filter set so we don't realloc it per mon. Empty
    // selection = filter is off.
    const raritySet = markRarities.length > 0 ? new Set(markRarities) : null;
    const evoCategorySet = markEvolutions.length > 0 ? new Set(markEvolutions) : null;
    // Hunt-tier filter set. The "null" hunt_tier (unassigned) maps to tier 3
    // (the default "Normal Horde" bucket), so picking tier 3 in the UI
    // matches both explicit T3 assignments and every unlisted mon.
    const tierSet = markTiers.length > 0 ? new Set(markTiers) : null;

    const out = data.pokemon.filter((p) => {
      if (rkey) {
        if (!p.dex || !(p.dex[rkey] > 0)) return false;
      }
      // Shared mon-attribute gates (see src/lib/monFilters.js) — these same
      // predicates drive the Plan view's per-mon filtering.
      if (!matchesTypes(p, markTypes)) return false;
      if (searchFamilyIds && !searchFamilyIds.has(p.id)) return false;
      if (stateSet) {
        const s = stateOf(trackerState, p.id);
        if (!stateSet.has(s)) return false;
      }
      if (!matchesBaby(p, markBaby)) return false;
      // Rarity gate. Two semantics:
      //   'only' — every one of this mon's encounter rarities must be in
      //            raritySet (i.e. the mon is found EXCLUSIVELY at selected
      //            rarities). Empty locations → fails (nothing to satisfy).
      //   'any'  — at least one location matches.
      if (raritySet) {
        const locs = p.locations || [];
        if (locs.length === 0) return false;
        if (markRaritiesMode === 'only') {
          for (const l of locs) if (!raritySet.has(l.rarity)) return false;
        } else {
          let matched = false;
          for (const l of locs) if (raritySet.has(l.rarity)) { matched = true; break; }
          if (!matched) return false;
        }
      }
      if (!matchesEvolution(p, evoCategorySet)) return false;
      if (!matchesTier(p, tierSet)) return false;
      return true;
    });

    if (markSort === 'name')    out.sort((a, b) => a.name.localeCompare(b.name));
    else if (markSort === 'bst') out.sort((a, b) => statTotal(b.stats) - statTotal(a.stats));
    else if (markSort === 'tier') {
      // Lower tier number = higher hunt priority → sort ascending. Unassigned
      // (null) treated as 3 (the default "Normal Horde" bucket). Ties broken
      // by dex number so the order within a tier stays predictable.
      out.sort((a, b) => {
        const ta = a.hunt_tier ?? 3;
        const tb = b.hunt_tier ?? 3;
        if (ta !== tb) return ta - tb;
        return a.id - b.id;
      });
    }
    else if (rkey)              out.sort((a, b) => (a.dex[rkey] || 0) - (b.dex[rkey] || 0));
    else                        out.sort((a, b) => a.id - b.id);
    return out;
  }, [data.pokemon, deferredSearch, markRegion, markTypes, markStates, markSort, markBaby, markRarities, markRaritiesMode, markEvolutions, markTiers, trackerState, familyMap]);

  // ─────── Selection (for bulk actions) ───────
  // Set<pokemonId>. Lives locally — selection is ephemeral and tab-scoped.
  const [selected, setSelected] = useState(() => new Set());
  const lastClickedId = useRef(null);

  const handleClick = useCallback((id, e) => {
    if (e.shiftKey) {
      // Shift-click toggles selection. Doesn't change state.
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      lastClickedId.current = id;
      return;
    }
    // Plain click cycles state.
    setMonState(id, cycleClick(stateOf(trackerState, id)));
    lastClickedId.current = id;
  }, [setMonState, trackerState]);

  const [showFilters, setShowFilters] = useState(false);
  // How many filter groups are narrowing the grid (shown on the Filters button).
  const activeFilterCount =
    (markRegion !== 'All' ? 1 : 0) + (markTypes.length ? 1 : 0) + (markStates.length ? 1 : 0)
    + (markBaby !== 'any' ? 1 : 0) + (markRarities.length ? 1 : 0)
    + (markEvolutions.length ? 1 : 0) + (markTiers.length ? 1 : 0);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const applyBulk = useCallback((state) => {
    setManyMonStates([...selected], state);
    setSelected(new Set());
  }, [selected, setManyMonStates]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
      <TrackerProgress data={data} trackerState={trackerState} catchLog={catchLog} onLogCatch={onLogCatch} />

      {/* Search, sort, and the filter drawer */}
      <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <DexSearchInput
            className="flex-1 min-w-[200px]"
            value={markSearch}
            onChange={setSearch}
            placeholder="Search by name or dex number"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-stone-500 dark:text-stone-400">Sort</label>
            <select
              value={markSort}
              onChange={(e) => setSort(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md border text-xs ${
              activeFilterCount
                ? 'border-blue-300 text-blue-700 dark:border-blue-900 dark:text-blue-300'
                : 'border-[#d6c8a3] dark:border-stone-700 text-stone-600 dark:text-stone-300'}`}
          >
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => updateView({ markRegion: 'All', markTypes: [], markStates: [], markBaby: 'any', markRarities: [], markEvolutions: [], markTiers: [] })}
              className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 underline underline-offset-2"
            >
              Clear
            </button>
          )}
          <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
            {filtered.length} mon{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
        {showFilters && (<>

        <RegionPills value={markRegion} onChange={setRegion} />

        <TypePills value={markTypes} onChange={setTypes} />

        <FilterRow
          label="State"
          options={STATE_FILTERS}
          selected={markStates}
          onToggle={toggleStateFilter}
          color="blue"
          onClear={() => updateView({ markStates: [] })}
        />

        {/* Babies — three-way single-select (Any / Babies only / Hide babies).
            The breed-only forms (Pichu, Cleffa, …) as a togglable group. */}
        <FilterRow
          label="Babies"
          mode="single"
          options={BABY_FILTERS}
          selected={markBaby}
          onToggle={setBaby}
          color="pink"
        />

        {/* Encounter-rarity filter. "Only" mode (default) shows mons whose
            encounters fall EXCLUSIVELY within the selected rarities — pick
            "Special" alone to see event-only mons. "Any" mode loosens this to
            mons with at least one matching encounter. The Only/Any switch is
            passed as FilterRow children so it sits inline before Clear. */}
        <FilterRow
          label="Encounter"
          options={RARITY_FILTERS.map((r) => ({ key: r, label: r }))}
          selected={markRarities}
          onToggle={toggleRarityFilter}
          color="violet"
          onClear={() => updateView({ markRarities: [] })}
        >
          {markRarities.length > 0 && (
            <>
              <span className="text-xs text-stone-400 dark:text-stone-600 mx-1">·</span>
              {[{ key: 'only', label: 'Only' }, { key: 'any', label: 'Any' }].map(({ key, label }) => {
                const sel = markRaritiesMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setRaritiesMode(key)}
                    aria-pressed={sel}
                    title={key === 'only'
                      ? "Mon's encounters must ALL be in the selected rarities"
                      : "Mon has at least one encounter in the selected rarities"}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      sel
                        ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
                        : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 border-[#d6c8a3] dark:border-stone-700 hover:bg-[#ece2c4] dark:hover:bg-stone-800'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </>
          )}
        </FilterRow>

        {/* Evolution-method filter — 8 user-friendly buckets over the 27 raw
            evolution `type` strings. Multi-select OR; matches two-way
            (outgoing evolutions + incoming pre_evolution) so the whole family
            surfaces for any pick. */}
        <FilterRow
          label="Evolution"
          options={EVOLUTION_CATEGORIES}
          selected={markEvolutions}
          onToggle={toggleEvolutionFilter}
          color="emerald"
          onClear={() => updateView({ markEvolutions: [] })}
        />

        {/* Hunt-tier filter — only renders if the data carries the catalog.
            Per-option color comes from the catalog entry so each tier keeps
            its signature hue. */}
        {huntTierCatalog.length > 0 && (
          <FilterRow
            label="Hunt tier"
            options={huntTierCatalog.map((t) => ({
              key: t.tier, label: `T${t.tier} ${t.label}`, title: t.blurb, color: t.color,
            }))}
            selected={markTiers}
            onToggle={toggleTierFilter}
            onClear={() => updateView({ markTiers: [] })}
          />
        )}
        </>)}
      </section>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar count={selected.size} onApply={applyBulk} onClear={clearSelection} />
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-stone-500 dark:text-stone-400">No Pokémon match.</div>
      ) : (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(58px, 1fr))' }}>
          {filtered.map((p) => (
            <TrackerCell
              key={p.id}
              pokemon={p}
              state={stateOf(trackerState, p.id)}
              isSelected={selected.has(p.id)}
              onClick={handleClick}
              openPanel={openPanel}
              tierMeta={p.hunt_tier != null ? huntTierByNum.get(p.hunt_tier) : null}
            />
          ))}
        </div>
      )}
    </main>
  );
}

/* ─────────────── Dense dex cell ─────────────── */
// Sprite-only tile: caught in colour, uncaught dim, priority ringed amber.
// Click cycles caught, shift-click selects, right-click/long-press opens the
// catch panel — the same gestures the old card had.
const TrackerCell = memo(function TrackerCell({ pokemon: p, state, isSelected, onClick, openPanel, tierMeta }) {
  const longPress = useLongPress(useCallback(() => openPanel(p.id), [openPanel, p.id]));
  const onCellClick = useCallback((e) => onClick(p.id, e), [onClick, p.id]);
  const onContextMenu = useCallback((e) => { e.preventDefault(); openPanel(p.id); }, [openPanel, p.id]);

  const caught = state === 'caught';
  const skipped = state === 'skipped';
  const priority = state === 'priority';

  return (
    <button
      type="button"
      onClick={onCellClick}
      onContextMenu={onContextMenu}
      {...longPress}
      aria-pressed={isSelected}
      title={`#${p.id} ${p.name}${tierMeta ? ` · ${tierMeta.label}` : ''} — ${state}`}
      className={`group relative aspect-square rounded-md border flex items-center justify-center transition-colors
                  ${isSelected ? 'ring-2 ring-blue-500 ' : ''}
                  ${caught
                    ? 'border-emerald-400/70 bg-emerald-500/10'
                    : priority
                      ? 'border-amber-400 bg-amber-400/10'
                      : skipped
                        ? 'border-[#e6dabf] dark:border-stone-800 bg-transparent'
                        : 'border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 hover:border-blue-400'}`}
    >
      <PokemonSprite
        pokemon={p}
        variant="still"
        loading="lazy"
        className={`w-9 h-9 object-contain transition ${caught ? '' : skipped ? 'opacity-20 grayscale' : 'opacity-45 grayscale group-hover:opacity-80'}`}
      />
      {caught && <span className="absolute bottom-0.5 right-0.5 text-[9px] text-emerald-600 dark:text-emerald-400">✓</span>}
      {priority && <span className="absolute top-0.5 left-0.5 text-[9px] text-amber-600 dark:text-amber-400">★</span>}
      <span className="pointer-events-none absolute -bottom-0.5 left-0 right-0 truncate px-0.5 text-[8px] leading-tight text-stone-500 opacity-0 group-hover:opacity-100 bg-[#fdf8e9]/90 dark:bg-stone-900/90">
        {p.name}
      </span>
    </button>
  );
});

/* ─────────────── Bulk action bar ─────────────── */

function BulkBar({ count, onApply, onClear }) {
  return (
    <div className="sticky top-[60px] z-10 flex items-center gap-2 flex-wrap rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm">
      <span className="font-semibold text-blue-900 dark:text-blue-200">{count} selected</span>
      <span className="text-stone-400">·</span>
      <BulkBtn onClick={() => onApply('caught')}>Caught</BulkBtn>
      <BulkBtn onClick={() => onApply('uncaught')}>Uncaught</BulkBtn>
      <BulkBtn onClick={() => onApply('priority')}>Priority</BulkBtn>
      <BulkBtn onClick={() => onApply('skipped')}>Skipped</BulkBtn>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
      >
        <X size={12} /> Clear selection
      </button>
    </div>
  );
}

function BulkBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-md text-xs font-medium border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200"
    >
      Mark {children}
    </button>
  );
}

/* ─────────────── Tracker card ─────────────── */

const TrackerCard = memo(function TrackerCard({ pokemon: p, region, state, isSelected, onClick, openPanel, tierMeta }) {
  const longPress = useLongPress(useCallback(() => openPanel(p.id), [openPanel, p.id]));

  const onCardClick   = useCallback((e) => onClick(p.id, e), [onClick, p.id]);
  const onContextMenu = useCallback((e) => { e.preventDefault(); openPanel(p.id); }, [openPanel, p.id]);

  const dimmed   = state === 'caught' || state === 'skipped';
  const priority = state === 'priority';
  const caught   = state === 'caught';
  const skipped  = state === 'skipped';

  return (
    <button
      type="button"
      onClick={onCardClick}
      onContextMenu={onContextMenu}
      {...longPress}
      aria-pressed={isSelected}
      className={`group relative flex flex-col items-center text-center p-3 rounded-lg
                  bg-[#fdf8e9] border hover:shadow-md dark:bg-stone-900
                  ${isSelected
                    ? 'border-blue-500 ring-2 ring-blue-300 dark:ring-blue-900'
                    : priority
                      ? 'border-amber-400 dark:border-amber-700'
                      : 'border-[#e6dabf] dark:border-stone-800 hover:border-[#c4b486] dark:hover:border-stone-600'}
                  transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      <PokemonCardBody
        pokemon={p}
        region={region}
        dimmed={dimmed}
        overlays={
          <>
            {/* Hunt-tier badge — top-LEFT, opposite the state badge. Tooltip
                carries the per-mon hunt_tier_note so users get the "why"
                without leaving the grid. */}
            {tierMeta && (
              <span
                className={`absolute top-1 left-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold shadow ${TIER_STYLE[tierMeta.color]?.badge || TIER_STYLE.stone.badge}`}
                title={`${tierMeta.label} (T${tierMeta.tier})${p.hunt_tier_note ? ' — ' + p.hunt_tier_note : ''}`}
              >
                T{tierMeta.tier}
              </span>
            )}
            {caught && (
              <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
            {priority && (
              <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-stone-900 shadow">
                <Star size={12} fill="currentColor" />
              </span>
            )}
            {skipped && (
              <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-500 text-white shadow">
                <Slash size={12} strokeWidth={3} />
              </span>
            )}
          </>
        }
      />
    </button>
  );
});

function useLongPress(onLongPress, ms = 500) {
  const timer = useRef(null);
  const start = useCallback((e) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onLongPress(e), ms);
  }, [onLongPress, ms]);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return { onTouchStart: start, onTouchEnd: cancel, onTouchMove: cancel, onTouchCancel: cancel };
}
