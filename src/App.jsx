import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import PokemonModal from './components/PokemonModal.jsx';
import Pokedex from './pages/Pokedex.jsx';
import { loadStore as loadBoxStore, saveStore as saveBoxStore, addMon as boxAddMon, blankBoxMon } from './lib/box.js';
import { loadStore as loadTeamsStore, saveStore as saveTeamsStore, addMember as teamAddMember, blankSet, teamById, MAX_MEMBERS } from './lib/teams.js';
import Toaster from './components/Toaster.jsx';
import { showToast } from './lib/toast.js';

// Heavy / non-landing pages are code-split so the initial load (the Pokédex)
// doesn't pay for Leaflet (RegionMap ≈ 150 KB+), the breeding optimizer, etc.
// Each becomes its own chunk fetched on first navigation. Pokedex stays eager
// since it's the default route and lazy-loading it would just add a flash.
const Locations       = lazy(() => import('./pages/Locations.jsx'));
const Tracker         = lazy(() => import('./pages/Tracker.jsx'));
const BoxPage         = lazy(() => import('./pages/Box.jsx'));
const DamageCalc      = lazy(() => import('./pages/DamageCalc.jsx'));
const TeamBuilder     = lazy(() => import('./pages/TeamBuilder.jsx'));
const TrainerPrep     = lazy(() => import('./pages/TrainerPrep.jsx'));
const BreedingPlanner = lazy(() => import('./pages/BreedingPlanner.jsx'));
const RegionMap       = lazy(() => import('./pages/RegionMap.jsx'));
const TrainerScribe   = lazy(() => import('./pages/TrainerScribe.jsx'));

// The dataset (~6.7 MB) is served as a static asset from public/ and fetched
// at runtime rather than bundled into the JS — that single change drops the
// initial JS payload by ~500 KB gzipped. BASE_URL makes it resolve in dev (/)
// and prod (/PokeKit/) alike.
const DATA_URL = `${import.meta.env.BASE_URL}data/pokemmo.json`;

const LS = {
  view:    'pokemmo:view',
  theme:   'pokemmo:theme',
  tracker: 'tracker:state',
};

function initialView() {
  if (typeof window === 'undefined') return 'grid';
  const v = localStorage.getItem(LS.view);
  return v === 'list' ? 'list' : 'grid';
}

function initialTheme() {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(LS.theme);
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

// Unified Pokédex state (post Search-merge). Carries every field the merged
// Pokedex page reads — the simple toolbar uses search/region/types/sort, the
// advanced sidebar uses the rest. See src/pages/Pokedex.jsx.
const INITIAL_POKEDEX = {
  search: '', region: 'All', sort: 'dex',
  types: [], typesMode: 'all',
  selectedMoveIds: [null, null, null, null], movesMode: 'all',
  abilityId: null, heldItemId: null,
  eggGroups: [], eggGroupsMode: 'any',
  stats: { hp: null, attack: null, defense: null, sp_attack: null, sp_defense: null, speed: null, bst: null },
};
const INITIAL_LOCATIONS = { search: '', region: 'Kanto', sort: 'game', methods: [], rarities: [] };
const INITIAL_TRACKER_VIEW = { view: 'plan', planRegion: 'All', planMethods: [], planRarities: [], hideSingles: true,
  // Plan mon-attribute filters — shared predicates with the Mark view
  // (src/lib/monFilters.js). planTypes (≤2), planBaby (any|only|exclude),
  // planEvolutions (category keys), planTiers (hunt-tier numbers).
  planTypes: [], planBaby: 'any', planEvolutions: [], planTiers: [],
  // Mark-tab filters:
  //   markBaby           'any' | 'only' | 'exclude'  — gate by pokemon.is_baby
  //   markRarities       [] | string[]               — selected encounter rarities
  //   markRaritiesMode   'only' | 'any'              — 'only' = found EXCLUSIVELY
  //                                                    at the selected rarities
  //   markEvolutions     [] | string[]               — evolution-method buckets
  //                                                    (see EVOLUTION_CATEGORIES
  //                                                    in TrackerMark.jsx)
  //   markTiers          [] | number[]               — hunt tiers (data/raw/
  //                                                    hunt-tiers.json)
  markSearch: '', markRegion: 'All', markTypes: [], markStates: [], markSort: 'dex',
  markBaby: 'any', markRarities: [], markRaritiesMode: 'only', markEvolutions: [], markTiers: [] };

// Read once from localStorage; default to {} so unlisted ids are 'uncaught'.
function loadTrackerState() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS.tracker);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

export default function App() {
  // Persisted across tabs
  const [view, setView]   = useState(initialView);
  const [theme, setTheme] = useState(initialTheme);

  // Dataset — fetched once at runtime (see DATA_URL).
  const [data, setData]         = useState(null);
  const [dataError, setDataError] = useState(null);

  // Page-specific state lifted here so it survives tab switches.
  const [pokedexState, setPokedexState]       = useState(INITIAL_POKEDEX);
  const [locationsState, setLocationsState]   = useState(INITIAL_LOCATIONS);
  const [trackerView, setTrackerView]         = useState(INITIAL_TRACKER_VIEW);
  const [trackerState, setTrackerStateRaw]    = useState(loadTrackerState);

  // The Box — shared across the Box page and the breeding planner.
  const [boxStore, setBoxStore]               = useState(loadBoxStore);
  useEffect(() => { saveBoxStore(boxStore); }, [boxStore]);

  // Teams — Team Builder store.
  const [teamsStore, setTeamsStore]           = useState(loadTeamsStore);
  useEffect(() => { saveTeamsStore(teamsStore); }, [teamsStore]);

  // Pokémon detail modal — shared so both pages can open it.
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setDataError(e.message || String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { localStorage.setItem(LS.view, view); }, [view]);
  useEffect(() => {
    localStorage.setItem(LS.theme, theme);
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
  }, [theme]);

  // Debounce-write tracker state so rapid toggling (e.g. shift-click bulk
  // marking) doesn't write to disk on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(LS.tracker, JSON.stringify(trackerState)); } catch {}
    }, 200);
    return () => clearTimeout(id);
  }, [trackerState]);

  // Mutators: setMonState(id, state) for one mon, setManyMonStates(ids, state)
  // for bulk. We delete keys when state is 'uncaught' to keep storage compact —
  // unlisted ids default to 'uncaught' on read.
  const setMonState = useCallback((id, state) => {
    setTrackerStateRaw((prev) => {
      const next = { ...prev };
      if (!state || state === 'uncaught') delete next[id];
      else next[id] = state;
      return next;
    });
  }, []);
  const setManyMonStates = useCallback((ids, state) => {
    setTrackerStateRaw((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (!state || state === 'uncaught') delete next[id];
        else next[id] = state;
      }
      return next;
    });
  }, []);
  // Merge an incoming { id: state } object into the existing tracker state.
  // Used by the JSON import — incoming entries override matching ids; ids
  // not in `incoming` are preserved.
  const mergeTrackerState = useCallback((incoming) => {
    setTrackerStateRaw((prev) => ({ ...prev, ...incoming }));
  }, []);

  const selected = useMemo(
    () => (data && selectedId != null ? data.pokemon.find((p) => p.id === selectedId) : null),
    [data, selectedId]
  );
  const handleSelect = useCallback((id) => setSelectedId(id), []);
  const handleClose  = useCallback(() => setSelectedId(null), []);

  // Quick "act on a mon" handlers — shared by the Pokédex cards and the detail
  // popup so you can file a Pokémon into the Box / a Team / the Tracker without
  // leaving the Pokédex. Each fires a toast for feedback.
  const nameOf = useCallback((id) => data?.pokemon.find((p) => p.id === id)?.name || 'Pokémon', [data]);
  const addMonToBox = useCallback((monId) => {
    const box = boxStore.boxes.find((b) => b.id === boxStore.activeBoxId) || boxStore.boxes[0];
    if (!box) return;
    setBoxStore((s) => boxAddMon(s, box.id, { ...blankBoxMon(), species: monId, addedAt: new Date().toISOString() }));
    showToast(`Added ${nameOf(monId)} to “${box.name}”`, { kind: 'success' });
  }, [boxStore, nameOf]);
  const addMonToTeam = useCallback((monId) => {
    const team = teamById(teamsStore, teamsStore.activeTeamId) || teamsStore.teams[0];
    if (!team) return;
    if (team.members.length >= MAX_MEMBERS) {
      showToast(`“${team.name}” is full (6 max) — start a new team in Team Builder`, { kind: 'warn' });
      return;
    }
    setTeamsStore((s) => teamAddMember(s, team.id, { ...blankSet(), monId }));
    showToast(`Added ${nameOf(monId)} to “${team.name}”`, { kind: 'success' });
  }, [teamsStore, nameOf]);
  const markCaught = useCallback((monId) => {
    setMonState(monId, 'caught');
    showToast(`Marked ${nameOf(monId)} as caught`, { kind: 'success' });
  }, [setMonState, nameOf]);

  // ── Boot states (all hooks above run unconditionally) ──
  if (dataError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6efdc] dark:bg-stone-950 px-4 text-center text-stone-700 dark:text-stone-300">
        <div>
          <p className="font-semibold text-red-600 dark:text-red-400">Couldn’t load Pokédex data.</p>
          <p className="mt-1 text-sm">{dataError}</p>
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-500">
            If you’re running locally, generate it with <code>npm run build:data</code>.
          </p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6efdc] dark:bg-stone-950 text-stone-500 dark:text-stone-400">
        <div className="animate-pulse text-sm">Loading Pokédex…</div>
      </div>
    );
  }

  return (
    <HashRouter>
      <div className="min-h-screen bg-[#f6efdc] dark:bg-stone-950 text-stone-900 dark:text-stone-100">
        <NavBar theme={theme} onTheme={setTheme} />

        <Suspense fallback={
          <div className="max-w-7xl mx-auto px-4 py-16 text-center text-sm text-stone-500 dark:text-stone-400">
            Loading…
          </div>
        }>
          <Routes>
            <Route
              path="/"
              element={
                <Pokedex
                  data={data}
                  state={pokedexState}
                  setState={setPokedexState}
                  view={view} onView={setView}
                  theme={theme} onTheme={setTheme}
                  onSelect={handleSelect}
                  onAddToBox={addMonToBox}
                  onAddToTeam={addMonToTeam}
                  onMarkCaught={markCaught}
                />
              }
            />
            {/* One route covers the grid and the deep-linked detail. The
                optional :region/:location params open a location as a modal
                over the grid (see Locations.jsx) — same component stays
                mounted, so the grid scroll survives open/close. */}
            <Route
              path="/locations/:region?/:location?"
              element={
                <Locations
                  data={data}
                  state={locationsState}
                  setState={setLocationsState}
                  theme={theme} onTheme={setTheme}
                  onSelect={handleSelect}
                />
              }
            />
            <Route
              path="/tracker"
              element={
                <Tracker
                  data={data}
                  trackerState={trackerState}
                  setMonState={setMonState}
                  setManyMonStates={setManyMonStates}
                  mergeTrackerState={mergeTrackerState}
                  view={trackerView}
                  setView={setTrackerView}
                  theme={theme} onTheme={setTheme}
                  onSelect={handleSelect}
                />
              }
            />
            <Route
              path="/box"
              element={
                <BoxPage
                  data={data}
                  store={boxStore}
                  setStore={setBoxStore}
                  onCaught={(id) => setMonState(id, 'caught')}
                  theme={theme} onTheme={setTheme}
                />
              }
            />
            <Route
              path="/scribe"
              element={
                <TrainerScribe
                  data={data}
                  theme={theme} onTheme={setTheme}
                />
              }
            />
            <Route
              path="/damage"
              element={
                <DamageCalc
                  data={data}
                  theme={theme} onTheme={setTheme}
                />
              }
            />
            <Route
              path="/teams"
              element={
                <TeamBuilder
                  data={data}
                  store={teamsStore}
                  setStore={setTeamsStore}
                  boxStore={boxStore}
                  theme={theme} onTheme={setTheme}
                />
              }
            />
            <Route
              path="/trainers"
              element={
                <TrainerPrep
                  data={data}
                  boxStore={boxStore}
                  theme={theme} onTheme={setTheme}
                />
              }
            />
            <Route
              path="/breeding"
              element={
                <BreedingPlanner
                  data={data}
                  theme={theme} onTheme={setTheme}
                  onSelect={handleSelect}
                  box={boxStore}
                />
              }
            />
            {/* Region interactive maps. One <RegionMap> component drives both
                regions — the `region` prop selects which data folder it reads
                and how it builds internal links. Each region gets two routes:
                the overworld view and a zone-detail view. */}
            <Route path="/map/sinnoh"           element={<RegionMap region="sinnoh" theme={theme} onTheme={setTheme} />} />
            <Route path="/map/sinnoh/:zoneId"   element={<RegionMap region="sinnoh" theme={theme} onTheme={setTheme} />} />
            <Route path="/map/johto"            element={<RegionMap region="johto"  theme={theme} onTheme={setTheme} />} />
            <Route path="/map/johto/:zoneId"    element={<RegionMap region="johto"  theme={theme} onTheme={setTheme} />} />
            {/* Backwards compatibility for old single-region bookmarks. The
                literal /map/sinnoh and /map/johto routes are matched first
                (Router 7 ranks literals above dynamic params), so /map/:zoneId
                here only catches numeric zone ids from the pre-Johto URL scheme. */}
            <Route path="/map"             element={<Navigate to="/map/sinnoh" replace />} />
            <Route path="/map/:zoneId"     element={<RegionMap region="sinnoh" theme={theme} onTheme={setTheme} />} />
            {/* Old URLs kept working for bookmarks. Search merged into Pokédex,
                so /search and /moves both land on the Pokédex now. The Catch
                Calc is no longer a standalone tab — it lives inside each
                Pokémon's detail popup — so /catch lands on the Pokédex too. */}
            <Route path="/search" element={<Navigate to="/" replace />} />
            <Route path="/moves"  element={<Navigate to="/" replace />} />
            <Route path="/catch"  element={<Navigate to="/" replace />} />
            <Route path="*"       element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        <PokemonModal
          pokemon={selected}
          data={data}
          onClose={handleClose}
          onSelect={handleSelect}
          onAddToBox={addMonToBox}
          onAddToTeam={addMonToTeam}
          onMarkCaught={markCaught}
        />

        <footer className="max-w-7xl mx-auto px-4 py-6 text-xs text-stone-400 dark:text-stone-600 text-center">
          {data.meta.total_pokemon} Pokémon · {data.meta.total_moves} moves · built {new Date(data.meta.built_at).toLocaleDateString()}
        </footer>

        <Toaster />
      </div>
    </HashRouter>
  );
}
