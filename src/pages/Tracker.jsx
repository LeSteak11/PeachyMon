import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sun, Moon, Download, Upload } from 'lucide-react';
import CatchInfoPanel from '../components/CatchInfoPanel.jsx';
import TrackerPlan from './TrackerPlan.jsx';
import TrackerMark from './TrackerMark.jsx';
import { stateOf, exportTrackerState, parseImport } from '../lib/tracker.js';

export default function Tracker({
  data,
  catchLog, onLogCatch,
  trackerState, setMonState, setManyMonStates, mergeTrackerState,
  view, setView,
  theme, onTheme,
  onSelect,
}) {
  // Catch info panel — opened on right-click / long-press from either view.
  const [panelMonId, setPanelMonId] = useState(null);
  // Plan's location modal open-key is lifted here so "Full Pokédex entry"
  // (fired from the catch panel) can close BOTH the panel and the Plan modal
  // before the App-level detail modal opens — otherwise the Plan modal would
  // sit orphaned underneath it (#1).
  const [planOpenKey, setPlanOpenKey] = useState(null);
  const panelMon = useMemo(
    () => (panelMonId != null ? data.pokemon.find((p) => p.id === panelMonId) : null),
    [panelMonId, data.pokemon]
  );

  const openPanel  = useCallback((id) => setPanelMonId(id), []);
  const closePanel = useCallback(() => setPanelMonId(null), []);

  // Index helper used by both views — Map<pokemonId, pokemon>.
  const pokemonById = useMemo(() => {
    const m = new Map();
    for (const p of data.pokemon) m.set(p.id, p);
    return m;
  }, [data.pokemon]);

  // Stable view-state slice setters.
  const updateView = useCallback((patch) => setView((v) => ({ ...v, ...patch })), [setView]);
  const setMode = useCallback((mode) => updateView({ view: mode }), [updateView]);

  // Export / import state.
  const fileInputRef = useRef(null);
  const [feedback, setFeedback] = useState(null); // { kind: 'ok' | 'err', text }
  // Auto-clear feedback after 3 s.
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(id);
  }, [feedback]);

  const handleExport = useCallback(() => {
    const { filename, blob } = exportTrackerState(trackerState);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    const n = Object.keys(trackerState).length;
    setFeedback({ kind: 'ok', text: `Exported ${n} state${n === 1 ? '' : 's'}` });
  }, [trackerState]);

  const handleImportClick = useCallback(() => fileInputRef.current?.click(), []);
  const handleImportFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    try {
      const text = await file.text();
      const { state, count } = parseImport(text);
      mergeTrackerState(state);
      setFeedback({ kind: 'ok', text: `Imported ${count} state${count === 1 ? '' : 's'}` });
    } catch {
      setFeedback({ kind: 'err', text: "Couldn't read this file" });
    }
  }, [mergeTrackerState]);

  return (
    <>
      {/* Slim toolbar with view toggle + theme */}
      <div className="sticky top-0 z-20 bg-[#f6efdc]/95 dark:bg-stone-950/95 backdrop-blur border-b border-[#e6dabf] dark:border-stone-800">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
            <ViewBtn active={view.view === 'mark'} onClick={() => setMode('mark')}>Progress</ViewBtn>
            <ViewBtn active={view.view === 'plan'} onClick={() => setMode('plan')}>Plan</ViewBtn>
          </div>
          <ProgressSummary trackerState={trackerState} total={data.pokemon.length} />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExport}
              className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                         text-stone-700 dark:text-stone-300"
              title="Export tracker state to JSON"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                         text-stone-700 dark:text-stone-300"
              title="Import tracker state from JSON (merges)"
            >
              <Upload size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportFile}
              className="hidden"
              aria-hidden
            />
            <button
              type="button"
              onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700
                         bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800
                         text-stone-700 dark:text-stone-300"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
        {feedback && (
          <div className={`max-w-7xl mx-auto px-4 pb-2 text-xs ${feedback.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {feedback.text}
          </div>
        )}
      </div>

      {view.view === 'plan' ? (
        <TrackerPlan
          data={data}
          pokemonById={pokemonById}
          trackerState={trackerState}
          setMonState={setMonState}
          view={view}
          updateView={updateView}
          openPanel={openPanel}
          openKey={planOpenKey}
          setOpenKey={setPlanOpenKey}
        />
      ) : (
        <TrackerMark
          catchLog={catchLog}
          onLogCatch={onLogCatch}
          data={data}
          trackerState={trackerState}
          setMonState={setMonState}
          setManyMonStates={setManyMonStates}
          view={view}
          updateView={updateView}
          openPanel={openPanel}
        />
      )}

      {panelMon && (
        <CatchInfoPanel
          pokemon={panelMon}
          trackerState={trackerState}
          onSetState={setMonState}
          onOpenFullEntry={(id) => { closePanel(); setPlanOpenKey(null); onSelect(id); }}
          onClose={closePanel}
        />
      )}
    </>
  );
}

function ViewBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 text-sm font-medium ${active
        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
        : 'bg-[#fdf8e9] text-stone-700 hover:bg-[#ece2c4] dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'}`}
    >
      {children}
    </button>
  );
}

function ProgressSummary({ trackerState, total }) {
  const counts = useMemo(() => {
    let caught = 0, priority = 0, skipped = 0;
    for (const id of Object.keys(trackerState)) {
      const s = trackerState[id];
      if (s === 'caught')   caught++;
      else if (s === 'priority') priority++;
      else if (s === 'skipped')  skipped++;
    }
    const tracked = total - skipped; // skipped doesn't count against you
    const remaining = tracked - caught;
    const pct = tracked > 0 ? (caught / tracked) * 100 : 0;
    return { caught, priority, skipped, remaining, tracked, pct };
  }, [trackerState, total]);

  return (
    <div className="flex items-center gap-3 text-xs text-stone-600 dark:text-stone-400 flex-1 min-w-[280px]">
      <div className="font-mono tabular-nums">
        <span className="text-stone-900 dark:text-stone-100 font-semibold">{counts.caught}</span>
        <span className="mx-1">/</span>
        <span>{counts.tracked}</span>
        <span className="text-stone-400 dark:text-stone-500"> caught</span>
      </div>
      <div className="font-mono tabular-nums hidden sm:inline">
        <span className="text-amber-600 dark:text-amber-400 font-semibold">{counts.priority}</span>
        <span className="text-stone-400 dark:text-stone-500"> priority</span>
      </div>
      <div className="font-mono tabular-nums hidden sm:inline">
        <span className="text-stone-500 dark:text-stone-400 font-semibold">{counts.skipped}</span>
        <span className="text-stone-400 dark:text-stone-500"> skipped</span>
      </div>
      <div className="font-mono tabular-nums hidden md:inline">
        <span className="font-semibold">{counts.remaining}</span>
        <span className="text-stone-400 dark:text-stone-500"> remaining</span>
      </div>
      {/* Progress bar */}
      <div className="flex-1 max-w-[200px] h-1.5 rounded-full bg-[#e0d4b5] dark:bg-stone-800 overflow-hidden">
        <div
          className="h-full bg-emerald-500 dark:bg-emerald-400 transition-[width] duration-200"
          style={{ width: `${counts.pct}%` }}
        />
      </div>
    </div>
  );
}
