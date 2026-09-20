import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sun, Moon, Crop, X, Download, Play, Square, Save, Trash2, RefreshCw } from 'lucide-react';
import PokemonSprite from '../components/PokemonSprite.jsx';
import { isDesktop, listWindows, captureAndOcr, downloadText } from '../lib/desktop.js';
import {
  buildObservation, mergeObservation, loadScribe, saveScribe, scribeToJSON,
  parseOpponentBar, parseRoute,
} from '../lib/trainerScribe.js';

const LS_REGIONS = 'pokemmo:scribe:regions';
const LS_GAMEREGION = 'pokemmo:scribe:gameregion';
const GAME_REGIONS = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova'];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const REGION_DEFS = [
  { key: 'log',      label: 'Battle log',   hint: 'the chat box where "The foe\'s X used Y!" appears' },
  { key: 'opponent', label: 'Opponent bar', hint: 'the foe HP bar (top-left): "Umbreon Lv. 43 ♂"' },
  { key: 'route',    label: 'Route / area', hint: 'the top-left area text: "Route 37 Ch. 1"' },
];

function loadRegions() {
  try { const r = JSON.parse(localStorage.getItem(LS_REGIONS)); if (r && typeof r === 'object') return r; } catch { /* ignore */ }
  return {};
}
function saveRegions(r) { try { localStorage.setItem(LS_REGIONS, JSON.stringify(r)); } catch { /* ignore */ } }

// Trainer Scribe — a dev-only authoring tool. Watches a PokéMMO battle and
// records the opponent trainer's team / moves / levels / reward into an
// accretive profile, so playing the game builds the trainerInstances data the
// catalog ships empty. Capture is desktop-only; a paste box lets you test the
// parser anywhere.
export default function TrainerScribe({ data, theme, onTheme }) {
  const desktop = isDesktop();
  const byNorm = useMemo(() => {
    const m = new Map();
    for (const p of data.pokemon) m.set(norm(p.name), p);
    return m;
  }, [data.pokemon]);
  const moveNames = useMemo(() => new Set(Object.values(data.moves).map((mv) => norm(mv.name))), [data.moves]);

  const [scribe, setScribe] = useState(loadScribe);
  useEffect(() => { saveScribe(scribe); }, [scribe]);

  // Current-battle accumulation.
  const [logLines, setLogLines] = useState([]);
  const [bars, setBars] = useState([]);
  const [routeText, setRouteText] = useState('');
  const [pasteText, setPasteText] = useState('');
  // Which game region the captured trainers belong to — tags each profile so the
  // export merges into the right region's trainer-instances catalog.
  const [gameRegion, setGameRegion] = useState(() => {
    try { const v = localStorage.getItem(LS_GAMEREGION); return GAME_REGIONS.includes(v) ? v : 'johto'; } catch { return 'johto'; }
  });
  useEffect(() => { try { localStorage.setItem(LS_GAMEREGION, gameRegion); } catch { /* ignore */ } }, [gameRegion]);

  // Capture state (desktop).
  const [windows, setWindows] = useState([]);
  const [hwnd, setHwnd] = useState(null);
  const [regions, setRegions] = useState(loadRegions);
  const [recording, setRecording] = useState(false);
  const [calib, setCalib] = useState(null); // { key, src }
  const [status, setStatus] = useState(null);

  const obs = useMemo(() => buildObservation({ logLines, bars, routeText, region: gameRegion, knownSpecies: byNorm }), [logLines, bars, routeText, gameRegion, byNorm]);

  // Auto-save when a battle completes (during live recording). Refs let the
  // capture loop read the latest values without re-subscribing each tick.
  const [autoSave, setAutoSave] = useState(() => { try { return localStorage.getItem('pokemmo:scribe:autosave') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('pokemmo:scribe:autosave', autoSave ? '1' : '0'); } catch { /* ignore */ } }, [autoSave]);
  const [completePrompt, setCompletePrompt] = useState(false);
  const obsRef = useRef(obs); obsRef.current = obs;
  const autoSaveRef = useRef(autoSave); autoSaveRef.current = autoSave;
  const seenAllRef = useRef(new Set()); // every log line ever seen — dedup + battle-boundary detection
  const savedRef = useRef(false);       // has the current battle been saved?

  /* ── capture wiring ── */
  const refresh = useCallback(async () => {
    try {
      const list = await listWindows();
      setWindows(list || []);
      const guess = (list || []).find((w) => /pok[eé]mmo/i.test(w.title));
      if (guess) setHwnd((h) => h ?? guess.hwnd);
    } catch (e) { setStatus({ kind: 'err', msg: String(e?.message || e) }); }
  }, []);
  useEffect(() => { if (desktop) refresh(); }, [desktop, refresh]);

  const tickRef = useRef(null);
  const busyRef = useRef(false);
  tickRef.current = async () => {
    if (busyRef.current || !hwnd) return;
    busyRef.current = true;
    try {
      if (regions.log) {
        const p = await captureAndOcr({ hwnd, rect: regions.log });
        const ls = linesFromWords(p.words);
        // Only lines we've never seen (timestamps make each battle's lines unique).
        const fresh = ls.map((l) => l.trim()).filter((l) => l && !seenAllRef.current.has(l));
        if (fresh.length) {
          fresh.forEach((l) => seenAllRef.current.add(l));
          if (fresh.some((l) => /You are challenged by/i.test(l))) {
            // New battle started → auto-save the previous one (if enabled and
            // unsaved), then reset the buffer to the new battle's lines.
            const prev = obsRef.current;
            if (autoSaveRef.current && prev.trainer && !savedRef.current) {
              setScribe((s) => mergeObservation(s, prev, new Date().toISOString()));
            }
            savedRef.current = false;
            setBars([]);
            setLogLines(fresh);
          } else {
            setLogLines((prevLines) => [...prevLines, ...fresh]);
          }
        }
      }
      if (regions.opponent) {
        const p = await captureAndOcr({ hwnd, rect: regions.opponent });
        const bar = parseOpponentBar(textOf(p));
        if (bar && bar.species) setBars((prev) => upsertBar(prev, bar));
      }
      if (regions.route) {
        const p = await captureAndOcr({ hwnd, rect: regions.route });
        const r = parseRoute(textOf(p));
        if (r) setRouteText(r);
      }
    } catch (e) {
      setStatus({ kind: 'err', msg: `Capture failed: ${String(e?.message || e)}` });
    } finally {
      busyRef.current = false;
    }
  };

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => tickRef.current?.(), 1500);
    tickRef.current?.();
    return () => clearInterval(id);
  }, [recording]);

  // Battle complete (a "defeated" line was parsed) → auto-save while recording,
  // otherwise raise the save prompt. The savedRef guard fires this once.
  useEffect(() => {
    if (obs.defeated && obs.trainer && !savedRef.current) {
      if (autoSave && recording) {
        setScribe((s) => mergeObservation(s, obs, new Date().toISOString()));
        savedRef.current = true;
        setStatus({ kind: 'ok', msg: `Auto-saved ${obs.trainer} (${obs.team.length} mon) — battle complete.` });
      } else {
        setCompletePrompt(true);
      }
    }
  }, [obs.defeated, obs.trainer, autoSave, recording]); // eslint-disable-line react-hooks/exhaustive-deps

  const startCalibrate = async (key) => {
    if (!hwnd) { setStatus({ kind: 'warn', msg: 'Pick the PokéMMO window first.' }); return; }
    try {
      const p = await captureAndOcr({ hwnd });
      setCalib({ key, src: `data:image/png;base64,${p.pngBase64}` });
    } catch (e) { setStatus({ kind: 'err', msg: String(e?.message || e) }); }
  };

  const parsePaste = () => {
    const lines = pasteText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length) setLogLines((prev) => mergeUnique(prev, lines));
  };

  // Hard reset — discard the current battle and re-read from scratch.
  const clearBattle = () => { setLogLines([]); setBars([]); seenAllRef.current = new Set(); savedRef.current = false; setCompletePrompt(false); };
  const saveBattle = () => {
    if (!obs.trainer) { setStatus({ kind: 'warn', msg: 'No trainer parsed yet.' }); return; }
    setScribe((s) => mergeObservation(s, obs, new Date().toISOString()));
    savedRef.current = true;
    setCompletePrompt(false);
    setStatus({ kind: 'ok', msg: `Saved ${obs.trainer} (${obs.team.length} mon).` });
    // Clear the visible buffer but keep `seenAll` so the finished log isn't re-added.
    setLogLines([]); setBars([]);
  };
  const exportJSON = () => downloadText(scribeToJSON(scribe), 'trainer-teams.json');

  const profiles = Object.entries(scribe.trainers);
  const regionsSet = REGION_DEFS.filter((r) => regions[r.key]).length;

  return (
    <main className="max-w-5xl mx-auto px-4 py-4 space-y-3">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Trainer Scribe</h1>
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">dev</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={exportJSON} disabled={profiles.length === 0}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs disabled:opacity-40">
            <Download size={13} /> Export trainer-teams.json
          </button>
          <button type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-200">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        Battle a trainer with recording on; the foe's team, moves, levels, and reward accrue into a profile —
        battle them again another day to fill in the rest. Exports merge into the trainerInstances catalog by name + route.
      </p>

      {/* Game region — tags every captured trainer so the export lands in the
          right region's catalog. */}
      <div className="flex items-center gap-2 rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 px-3 py-2">
        <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">Game region</span>
        <div className="flex flex-wrap gap-1">
          {GAME_REGIONS.map((r) => (
            <button key={r} type="button" onClick={() => setGameRegion(r)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${gameRegion === r
                ? 'bg-amber-600 border-amber-600 text-white'
                : 'border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-600 dark:text-stone-300 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}>
              {cap(r)}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-stone-400 dark:text-stone-500">tags new captures</span>
      </div>

      {/* Capture controls (desktop only) */}
      {desktop ? (
        <section className="rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={hwnd ?? ''} onChange={(e) => setHwnd(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 min-w-[180px] px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs">
              <option value="">Select the PokéMMO window…</option>
              {windows.map((w) => <option key={w.hwnd} value={w.hwnd}>{w.title || `Window ${w.hwnd}`}</option>)}
            </select>
            <button type="button" onClick={refresh} className="p-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-500"><RefreshCw size={13} /></button>
            <button type="button" onClick={() => setRecording((r) => !r)} disabled={!hwnd || regionsSet === 0}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-white disabled:opacity-50 ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {recording ? <><Square size={14} /> Stop</> : <><Play size={14} /> Record</>}
            </button>
            <label className="inline-flex items-center gap-1 text-xs text-stone-700 dark:text-stone-300" title="Save the trainer automatically when the battle ends">
              <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} className="accent-blue-500" /> Auto-save on win
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {REGION_DEFS.map((r) => (
              <button key={r.key} type="button" onClick={() => startCalibrate(r.key)} title={r.hint}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${regions[r.key] ? 'border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300' : 'border-[#d6c8a3] dark:border-stone-700 text-stone-600 dark:text-stone-300'}`}>
                <Crop size={12} /> {r.label}{regions[r.key] ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-blue-800/80 dark:text-blue-200/80">
            Calibrate the 3 regions once (run PokéMMO borderless-windowed), then hit Record before a trainer battle.
            {recording && <span className="ml-1 text-red-600 dark:text-red-400 font-semibold">● recording…</span>}
          </div>
          {status && <div className={`text-[11px] ${status.kind === 'err' ? 'text-red-600 dark:text-red-400' : status.kind === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-stone-600 dark:text-stone-300'}`}>{status.msg}</div>}
        </section>
      ) : (
        <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 text-xs text-stone-500 dark:text-stone-400">
          Live capture is desktop-only. You can still paste a battle log below to test parsing.
        </section>
      )}

      {/* Paste fallback / tester */}
      <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
        <div className="text-xs font-semibold text-stone-600 dark:text-stone-300">Paste battle log (testing / fallback)</div>
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4}
          placeholder="[7:39:40 PM] [Battle] The foe's Umbreon used Foul Play! ( ... )"
          className="w-full px-2 py-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs font-mono" />
        <div className="flex items-center gap-2">
          <input value={routeText} onChange={(e) => setRouteText(e.target.value)} placeholder="Route (e.g. Route 37)"
            className="px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs w-40" />
          <button type="button" onClick={parsePaste} className="px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs">Parse</button>
        </div>
      </section>

      {/* Current battle */}
      <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-stone-800 dark:text-stone-200">Current battle</h2>
          <span className="text-[11px] text-stone-400">{logLines.length} log lines</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={saveBattle} disabled={!obs.trainer}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs disabled:opacity-40">
              <Save size={13} /> Save to profile
            </button>
            <button type="button" onClick={clearBattle} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#d6c8a3] dark:border-stone-700 text-xs text-stone-500">
              <Trash2 size={13} /> Clear
            </button>
          </div>
        </div>
        {completePrompt && obs.trainer && (
          <div className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 flex items-center gap-2 text-sm">
            <span className="text-emerald-800 dark:text-emerald-200">✓ Battle complete — <strong>{obs.trainer}</strong> ({obs.team.length} mon). Save to profile?</span>
            <div className="ml-auto flex gap-1.5">
              <button type="button" onClick={saveBattle} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs">Save</button>
              <button type="button" onClick={() => { setCompletePrompt(false); savedRef.current = true; }} className="px-2 py-1 rounded border border-stone-300 dark:border-stone-700 text-xs text-stone-600 dark:text-stone-300">Dismiss</button>
            </div>
          </div>
        )}
        {obs.trainer ? (
          <ObservationView obs={obs} byNorm={byNorm} moveNames={moveNames} />
        ) : (
          <div className="text-xs text-stone-400 dark:text-stone-500">No trainer parsed yet. Start a battle (or paste a log).</div>
        )}
      </section>

      {/* Saved profiles */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-200">Trainer profiles ({profiles.length})</h2>
        {profiles.length === 0 ? (
          <div className="text-xs text-stone-400 dark:text-stone-500">None yet — save a battle above.</div>
        ) : profiles.map(([key, p]) => (
          <div key={key} className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-stone-900 dark:text-stone-100">{p.name}</span>
              {p.region && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">{cap(p.region)}</span>}
              <span className="text-xs text-stone-500">{p.route}</span>
              {p.reward != null && <span className="text-xs text-emerald-600 dark:text-emerald-400">${p.reward.toLocaleString()}</span>}
              <span className="ml-auto text-[11px] text-stone-400">{p.battles} battle{p.battles === 1 ? '' : 's'} · {p.team.length} mon</span>
              <button type="button" onClick={() => setScribe((s) => { const t = { ...s.trainers }; delete t[key]; return { ...s, trainers: t }; })}
                className="p-0.5 text-stone-400 hover:text-red-600"><X size={13} /></button>
            </div>
            <div className="mt-2 grid sm:grid-cols-2 gap-1.5">
              {p.team.map((t, i) => <TeamMon key={i} mon={t} byNorm={byNorm} moveNames={moveNames} />)}
            </div>
          </div>
        ))}
      </section>

      {calib && (
        <RegionCalibrator
          src={calib.src}
          label={REGION_DEFS.find((r) => r.key === calib.key)?.label}
          initialRect={regions[calib.key]}
          onSave={(rect) => { const next = { ...regions, [calib.key]: rect }; setRegions(next); saveRegions(next); setCalib(null); }}
          onCancel={() => setCalib(null)}
        />
      )}
    </main>
  );
}

function ObservationView({ obs, byNorm, moveNames }) {
  return (
    <div>
      <div className="text-sm"><span className="font-semibold text-stone-900 dark:text-stone-100">{obs.trainer}</span>
        {obs.route && <span className="text-stone-500"> · {obs.route}</span>}
        {obs.reward != null && <span className="text-emerald-600 dark:text-emerald-400"> · ${obs.reward.toLocaleString()}</span>}
        {obs.defeated && <span className="text-stone-400"> · defeated ✓</span>}
      </div>
      <div className="mt-2 grid sm:grid-cols-2 gap-1.5">
        {obs.team.map((t, i) => <TeamMon key={i} mon={t} byNorm={byNorm} moveNames={moveNames} />)}
      </div>
    </div>
  );
}

function TeamMon({ mon, byNorm, moveNames }) {
  const sp = byNorm.get(norm(mon.species));
  return (
    <div className="flex items-center gap-2 rounded border border-[#ece2c4] dark:border-stone-800/60 bg-[#f7f0db]/60 dark:bg-stone-900/50 p-1.5">
      <div className="w-9 h-9 shrink-0 flex items-center justify-center">
        {sp ? <PokemonSprite pokemon={sp} variant="animated" loading="lazy" className="w-8 h-8 object-contain" /> : <span className="text-stone-300 dark:text-stone-700">?</span>}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-stone-800 dark:text-stone-200">
          {mon.species}{!sp && <span title="not found in dex" className="ml-1 text-amber-500">⚠</span>}
          {mon.level && <span className="text-stone-500"> · Lv {mon.level}</span>}
          {mon.gender === 'M' && <span className="text-blue-500"> ♂</span>}
          {mon.gender === 'F' && <span className="text-pink-500"> ♀</span>}
        </div>
        <div className="text-[10px] text-stone-500 dark:text-stone-400 truncate">
          {mon.moves.length ? mon.moves.map((mv, i) => (
            <span key={i}>{i > 0 && ', '}<span className={moveNames.has(norm(mv)) ? '' : 'text-amber-500'}>{mv}</span></span>
          )) : <span className="italic">no moves seen</span>}
        </div>
      </div>
    </div>
  );
}

// Drag a rectangle over the screenshot to mark a region. Normalized 0..1.
function RegionCalibrator({ src, label, initialRect, onSave, onCancel }) {
  const imgRef = useRef(null);
  const dragStart = useRef(null);
  const [sel, setSel] = useState(initialRect || null);
  const toNorm = (cx, cy) => {
    const r = imgRef.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (cx - r.left) / r.width)), y: Math.min(1, Math.max(0, (cy - r.top) / r.height)) };
  };
  const onDown = (e) => { e.preventDefault(); const p = toNorm(e.clientX, e.clientY); dragStart.current = p; setSel({ x: p.x, y: p.y, w: 0, h: 0 }); };
  const onMove = (e) => { if (!dragStart.current) return; const p = toNorm(e.clientX, e.clientY); const a = dragStart.current; setSel({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) }); };
  const valid = sel && sel.w > 0.01 && sel.h > 0.005;
  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex flex-col items-center justify-center p-4" onMouseUp={() => { dragStart.current = null; }} onMouseMove={onMove}>
      <div className="text-white text-sm mb-2">Drag a box around the <strong>{label}</strong>.</div>
      <div className="relative max-w-full max-h-[80vh] select-none">
        <img ref={imgRef} src={src} alt="calibration" draggable={false} onMouseDown={onDown} className="max-w-full max-h-[80vh] object-contain cursor-crosshair rounded" />
        {sel && <div className="absolute border-2 border-emerald-400 bg-emerald-400/15 pointer-events-none" style={{ left: `${sel.x * 100}%`, top: `${sel.y * 100}%`, width: `${sel.w * 100}%`, height: `${sel.h * 100}%` }} />}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded border border-stone-500 text-stone-200 hover:bg-white/10 text-sm">Cancel</button>
        <button type="button" disabled={!valid} onClick={() => onSave(sel)} className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-40">Save region</button>
      </div>
    </div>
  );
}

/* ── helpers ── */

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function textOf(payload) {
  if (payload?.text && payload.text.trim()) return payload.text;
  return linesFromWords(payload?.words).join(' ');
}

// Group OCR word boxes into visual lines (top→bottom, left→right) → strings.
function linesFromWords(words) {
  if (!Array.isArray(words) || !words.length) return [];
  const hs = words.map((w) => w.h || 0).filter(Boolean).sort((a, b) => a - b);
  const tol = Math.max(6, (hs[Math.floor(hs.length / 2)] || 12) * 0.6);
  const lines = [];
  for (const w of [...words].sort((a, b) => a.y - b.y)) {
    const yc = w.y + (w.h || 0) / 2;
    const line = lines.find((l) => Math.abs(l.yc - yc) <= tol);
    if (line) { line.words.push(w); line.yc = (line.yc * (line.words.length - 1) + yc) / line.words.length; }
    else lines.push({ yc, words: [w] });
  }
  return lines.sort((a, b) => a.yc - b.yc).map((l) => l.words.sort((a, b) => a.x - b.x).map((w) => w.text).join(' '));
}

function mergeUnique(prev, lines) {
  const seen = new Set(prev);
  const out = [...prev];
  for (const l of lines) { const t = l.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return out;
}

function upsertBar(prev, bar) {
  const i = prev.findIndex((b) => norm(b.species) === norm(bar.species));
  if (i === -1) return [...prev, bar];
  const next = [...prev]; next[i] = { ...next[i], level: bar.level ?? next[i].level, gender: bar.gender ?? next[i].gender }; return next;
}

