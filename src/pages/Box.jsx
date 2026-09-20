import { useMemo, useRef, useState } from 'react';
import {
  Sun, Moon, Plus, Trash2, Pencil, Check, X, Download, Upload, Search, Filter, ClipboardCopy, ArrowUpRight,
} from 'lucide-react';
import PokemonSprite from '../components/PokemonSprite.jsx';
import PokemonPicker from '../components/PokemonPicker.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import DexSearchInput from '../components/DexSearchInput.jsx';
import Modal from '../components/Modal.jsx';
import CapturePanel from '../components/CapturePanel.jsx';
import { dexNum } from '../lib/format.js';
import { IV_KEYS, IV_LABELS, NATURE_NAMES, genderRatioCategory } from '../lib/breeding/data.js';
import {
  blankBoxMon, perfectCount, boxById, allMons,
  addBox, renameBox, deleteBox, setActiveBox,
  addMon, addMons, updateMon, removeMon, moveMon,
  storeToJSON, storeFromJSON, appendImportedBoxes, boxToAiText,
} from '../lib/box.js';
import { showToast } from '../lib/toast.js';
import { downloadText } from '../lib/desktop.js';

const EMPTY_FILTERS = { search: '', types: [], gender: 'any', shiny: 'any', alpha: 'any', minPerfect: 0 };

export default function BoxPage({ data, store, setStore, theme, onTheme, onCaught }) {
  const [viewBoxId, setViewBoxId] = useState(() => store.activeBoxId); // boxId | 'all'
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [editId, setEditId] = useState(null);
  const fileRef = useRef(null);

  const byId = useMemo(() => new Map(data.pokemon.map((p) => [p.id, p])), [data.pokemon]);
  const allTypes = useMemo(() => [...new Set(data.pokemon.flatMap((p) => p.types))].sort(), [data.pokemon]);

  const activeBox = boxById(store, store.activeBoxId) || store.boxes[0];
  const viewingAll = viewBoxId === 'all';

  // Mons currently in view (a single box, or all boxes), each tagged with boxId.
  const viewMons = useMemo(() => {
    if (viewingAll) return allMons(store);
    const b = boxById(store, viewBoxId);
    return b ? b.mons.map((m) => ({ ...m, boxId: b.id })) : [];
  }, [store, viewBoxId, viewingAll]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const dexQ = q.replace(/^#/, '').match(/^\d+$/) ? parseInt(q, 10) : null;
    return viewMons.filter((m) => {
      const sp = m.species != null ? byId.get(m.species) : null;
      if (q) {
        const nameHit = sp && sp.name.toLowerCase().includes(q);
        const dexHit = dexQ != null && m.species === dexQ;
        if (!nameHit && !dexHit) return false;
      }
      if (filters.types.length) {
        if (!sp || !sp.types.some((t) => filters.types.includes(t))) return false;
      }
      if (filters.gender !== 'any' && m.gender !== filters.gender) return false;
      if (filters.shiny !== 'any' && (filters.shiny === 'yes') !== !!m.shiny) return false;
      if (filters.alpha !== 'any' && (filters.alpha === 'yes') !== !!m.alpha) return false;
      if (filters.minPerfect > 0 && perfectCount(m) < filters.minPerfect) return false;
      return true;
    });
  }, [viewMons, filters, byId]);

  const activeFilterCount =
    (filters.search ? 1 : 0) + (filters.types.length ? 1 : 0) +
    (filters.gender !== 'any' ? 1 : 0) + (filters.shiny !== 'any' ? 1 : 0) +
    (filters.alpha !== 'any' ? 1 : 0) + (filters.minPerfect > 0 ? 1 : 0);

  /* ── store handlers ── */
  const onAddBox = () => setStore((s) => { const ns = addBox(s); setViewBoxId(ns.activeBoxId); return ns; });
  const onRenameBox = (id, name) => setStore((s) => renameBox(s, id, name));
  const onDeleteBox = (id) => setStore((s) => { const ns = deleteBox(s, id); setViewBoxId(ns.activeBoxId); return ns; });
  const onSelectBox = (id) => { setViewBoxId(id); if (id !== 'all') setStore((s) => setActiveBox(s, id)); };
  const onAddMon = () => {
    const mon = { ...blankBoxMon(), addedAt: new Date().toISOString() };
    setStore((s) => addMon(s, s.activeBoxId, mon));
    if (viewingAll) setViewBoxId(store.activeBoxId);
    setEditId(mon.id);
  };
  // Captured mons are ones you own, so tick their species off in the Tracker.
  const onCaptureImport = (mons) => {
    setStore((s) => addMons(s, s.activeBoxId, mons));
    for (const m of mons) if (m.species != null) onCaught?.(m.species);
  };

  const nameOf = (id) => byId.get(id)?.name || null;
  const doExport = () => downloadText(storeToJSON(store, nameOf), 'pokemmo-box.json');
  const doCopyAi = async () => {
    try { await navigator.clipboard.writeText(boxToAiText(store, nameOf)); showToast('Box copied — paste it into your AI chat.'); }
    catch { showToast('Could not copy to the clipboard.'); }
  };
  const doImportFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { store: imported, error } = storeFromJSON(String(reader.result || ''));
      if (error || !imported) { window.alert(error || 'Import failed.'); return; }
      setStore((s) => { const ns = appendImportedBoxes(s, imported); setViewBoxId(ns.activeBoxId); return ns; });
    };
    reader.readAsText(file);
  };

  const editMon = editId ? allMons(store).find((m) => m.id === editId) : null;
  const totalCount = useMemo(() => allMons(store).length, [store]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-4">
      <header className="flex items-center gap-3 mb-3">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Box</h1>
        <span className="text-xs text-stone-500 dark:text-stone-400">{totalCount} mon{totalCount === 1 ? '' : 's'} across {store.boxes.length} box{store.boxes.length === 1 ? '' : 'es'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => fileRef.current?.click()} title="Import a Box JSON export"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs">
            <Upload size={13} /> Import
          </button>
          <button type="button" onClick={doCopyAi} disabled={totalCount === 0} title="Copy your Box as readable text to paste into an AI chat"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs disabled:opacity-40">
            <ClipboardCopy size={13} /> Copy for AI
          </button>
          <button type="button" onClick={doExport} disabled={totalCount === 0} title="Download your whole Box as JSON"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs disabled:opacity-40">
            <Download size={13} /> Export
          </button>
          <button type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200" title="Toggle theme">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => { doImportFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </header>

      <CapturePanel data={data} onImport={onCaptureImport} onUpdate={(id, patch) => setStore((s) => updateMon(s, id, patch))} target={editMon} />

      {/* Box tabs */}
      <div className="mt-3 flex items-center gap-1 flex-wrap border-b border-[#e6dabf] dark:border-stone-800 pb-2">
        <BoxTab label="All boxes" active={viewingAll} onClick={() => setViewBoxId('all')} count={totalCount} />
        {store.boxes.map((b) => (
          <BoxTabEditable
            key={b.id}
            box={b}
            active={!viewingAll && viewBoxId === b.id}
            onClick={() => onSelectBox(b.id)}
            onRename={(name) => onRenameBox(b.id, name)}
            onDelete={() => onDeleteBox(b.id)}
            canDelete={store.boxes.length > 1}
          />
        ))}
        <button type="button" onClick={onAddBox} title="Add a box"
          className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-[#ece2c4] dark:hover:bg-stone-800">
          <Plus size={15} />
        </button>
      </div>

      {/* Filter bar */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search name or #dex…"
            className="w-full pl-7 pr-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <Seg value={filters.gender} onChange={(v) => setFilters((f) => ({ ...f, gender: v }))}
          options={[['any', 'Any'], ['M', '♂'], ['F', '♀']]} />
        <Toggle label="★ Shiny" on={filters.shiny === 'yes'} onClick={() => setFilters((f) => ({ ...f, shiny: f.shiny === 'yes' ? 'any' : 'yes' }))} />
        <Toggle label="α Alpha" on={filters.alpha === 'yes'} onClick={() => setFilters((f) => ({ ...f, alpha: f.alpha === 'yes' ? 'any' : 'yes' }))} />
        <select value={filters.minPerfect} onChange={(e) => setFilters((f) => ({ ...f, minPerfect: Number(e.target.value) }))}
          className="px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs text-stone-700 dark:text-stone-300">
          {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 0 ? 'Any IVs' : `≥ ${n}×31`}</option>)}
        </select>
        <button type="button" onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md border text-xs ${filters.types.length ? 'border-blue-300 text-blue-700 dark:border-blue-900 dark:text-blue-300' : 'border-[#d6c8a3] dark:border-stone-700 text-stone-600 dark:text-stone-300'}`}>
          <Filter size={13} /> Types{filters.types.length ? ` (${filters.types.length})` : ''}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">Clear</button>
        )}
      </div>
      {showFilters && (
        <div className="mt-2 flex flex-wrap gap-1">
          {allTypes.map((t) => {
            const on = filters.types.includes(t);
            return (
              <button key={t} type="button"
                onClick={() => setFilters((f) => ({ ...f, types: on ? f.types.filter((x) => x !== t) : [...f.types, t] }))}
                className={`rounded ${on ? 'ring-2 ring-blue-500' : 'opacity-70 hover:opacity-100'}`}>
                <TypeBadge type={t} />
              </button>
            );
          })}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="mt-8 text-center text-sm text-stone-500 dark:text-stone-400">
          {viewMons.length === 0
            ? 'This box is empty. Add a mon, capture from the game (desktop), or import a Box JSON.'
            : 'No mons match these filters.'}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {filtered.map((m) => (
            <MonTile key={m.id} mon={m} sp={m.species != null ? byId.get(m.species) : null}
              showBox={viewingAll ? boxById(store, m.boxId)?.name : null}
              onClick={() => setEditId(m.id)} />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onAddMon}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm">
          <Plus size={14} /> Add mon{!viewingAll ? '' : ` to ${activeBox?.name}`}
        </button>
        <span className="text-xs text-stone-500 dark:text-stone-400">{filtered.length} shown</span>
      </div>

      {editMon && (
        <MonEditModal
          mon={editMon}
          data={data}
          boxes={store.boxes}
          onClose={() => setEditId(null)}
          onUpdate={(patch) => setStore((s) => updateMon(s, editMon.id, patch))}
          onMove={(toBox) => setStore((s) => moveMon(s, editMon.id, toBox))}
          onDelete={() => { setStore((s) => removeMon(s, editMon.id)); setEditId(null); }}
          onCaught={onCaught}
        />
      )}
    </main>
  );
}

/* ── Box tabs ── */

function BoxTab({ label, active, onClick, count }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-t-md text-sm font-medium border-b-2 -mb-2 transition-colors ${
        active ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}>
      {label}{count != null && <span className="ml-1 text-[10px] text-stone-400">{count}</span>}
    </button>
  );
}

function BoxTabEditable({ box, active, onClick, onRename, onDelete, canDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(box.name);
  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 px-1 -mb-2">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { onRename(name); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
          className="w-24 px-1.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm" />
        <button type="button" onClick={() => { onRename(name); setEditing(false); }} className="p-0.5 text-emerald-600"><Check size={13} /></button>
        <button type="button" onClick={() => { setName(box.name); setEditing(false); }} className="p-0.5 text-stone-400"><X size={13} /></button>
      </span>
    );
  }
  return (
    <span className={`group inline-flex items-center rounded-t-md -mb-2 border-b-2 ${active ? 'border-blue-500' : 'border-transparent'}`}>
      <button type="button" onClick={onClick}
        className={`pl-3 pr-1 py-1.5 text-sm font-medium transition-colors ${active ? 'text-blue-600 dark:text-blue-400' : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}>
        {box.name}<span className="ml-1 text-[10px] text-stone-400">{box.mons.length}</span>
      </button>
      {active && (
        <span className="flex items-center pr-1.5">
          <button type="button" onClick={() => { setName(box.name); setEditing(true); }} title="Rename box"
            className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"><Pencil size={12} /></button>
          {canDelete && (
            <button type="button"
              onClick={() => { if (window.confirm(`Delete "${box.name}" and its ${box.mons.length} mon(s)?`)) onDelete(); }}
              title="Delete box" className="p-0.5 text-stone-400 hover:text-red-600 dark:hover:text-red-400"><Trash2 size={12} /></button>
          )}
        </span>
      )}
    </span>
  );
}

/* ── grid tile ── */

function MonTile({ mon, sp, showBox, onClick }) {
  const perfect = perfectCount(mon);
  const g = mon.gender === 'M' ? '♂' : mon.gender === 'F' ? '♀' : '';
  return (
    <button type="button" onClick={onClick}
      className="relative rounded-lg border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 hover:border-blue-400 dark:hover:border-blue-700 hover:shadow-sm p-1.5 flex flex-col items-center transition-colors">
      <div className="absolute top-1 left-1 flex gap-0.5">
        {mon.shiny && <span title="Shiny" className="text-[10px] text-yellow-500">★</span>}
        {mon.alpha && <span title="Alpha" className="text-[10px] font-bold text-red-500">α</span>}
      </div>
      <span className={`absolute top-1 right-1 text-[10px] ${mon.gender === 'M' ? 'text-blue-500' : mon.gender === 'F' ? 'text-pink-500' : 'text-stone-400'}`}>{g}</span>
      <div className="w-12 h-12 flex items-center justify-center">
        {sp ? <PokemonSprite pokemon={sp} variant="animated" loading="lazy" className="w-11 h-11 object-contain" />
            : <span className="text-stone-300 dark:text-stone-700 text-2xl">?</span>}
      </div>
      <div className="mt-0.5 w-full text-center">
        <div className="text-[10px] truncate text-stone-700 dark:text-stone-300" title={mon.nickname || undefined}>{mon.nickname || (sp ? sp.name : 'Unknown')}</div>
        {mon.level != null && <div className="text-[9px] text-stone-500 dark:text-stone-400">Lv. {mon.level}</div>}
        <div className="text-[9px] text-stone-500 dark:text-stone-400">{perfect > 0 ? `${perfect}×31` : '—'}</div>
        {showBox && <div className="text-[8px] text-stone-400 truncate">{showBox}</div>}
      </div>
    </button>
  );
}

/* ── mon edit modal ── */

function MonEditModal({ mon, data, boxes, onClose, onUpdate, onMove, onDelete, onCaught }) {
  const breederPokemon = useMemo(() => data.pokemon, [data.pokemon]);
  const sp = mon.species != null ? data.pokemon.find((p) => p.id === mon.species) : null;
  const cat = sp ? (sp.id === 132 ? 'ditto' : genderRatioCategory(sp)) : null;
  const isMixed = cat === 'mixed';
  const itemNames = useMemo(() => [...new Set(Object.values(data.items).map((i) => i.name).filter(Boolean))].sort(), [data.items]);
  const moveNames = useMemo(() => [...new Set(Object.values(data.moves).map((m) => m.name).filter(Boolean))].sort(), [data.moves]);
  // Next stage(s) this species can evolve into, named from the dex.
  const evos = useMemo(() => (sp?.evolutions || [])
    .map((e) => ({ id: e.id, name: data.pokemon.find((p) => p.id === e.id)?.name || e.name }))
    .filter((e) => e.id != null && e.name), [sp, data.pokemon]);

  return (
    <Modal title="Edit mon" onClose={onClose} maxWidth="max-w-md">
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          {sp && <PokemonSprite pokemon={sp} variant="animated" className="w-12 h-12 object-contain" />}
          {sp && <span className="font-mono text-[11px] text-stone-500">{dexNum(sp.id)}</span>}
        </div>

        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400">Species</label>
          <PokemonPicker pokemon={breederPokemon} value={mon.species} onChange={(id) => onUpdate({ species: id })} placeholder="Pick species" />
          {/* Evolved in-game? Keep the same mon (IVs, level, moves) and just
              move it up its evolution line. */}
          {evos.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-stone-500 dark:text-stone-400">Evolved in-game?</span>
              {evos.map((e) => (
                <button key={e.id} type="button"
                  onClick={() => { onUpdate({ species: e.id }); onCaught?.(e.id); }}
                  title={`Change this mon into ${e.name}, keeping its IVs, level and moves`}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs">
                  <ArrowUpRight size={12} /> Evolve → {e.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400">IVs</label>
          <div className="grid grid-cols-6 gap-1 mt-1">
            {IV_KEYS.map((k) => (
              <label key={k} className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] uppercase text-stone-500 dark:text-stone-400">{IV_LABELS[k]}</span>
                <input type="number" min="0" max="31" value={mon.ivs[k]}
                  onChange={(e) => { let n = Math.round(Number(e.target.value)); if (!Number.isFinite(n)) n = 0; onUpdate({ ivs: { ...mon.ivs, [k]: Math.min(31, Math.max(0, n)) } }); }}
                  className={`w-full px-1 py-1 rounded border text-center text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 ${mon.ivs[k] === 31 ? 'bg-emerald-500 text-white border-emerald-600 font-bold' : 'bg-[#fdf8e9] dark:bg-stone-900 text-stone-800 dark:text-stone-200 border-[#d6c8a3] dark:border-stone-700'}`} />
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400">Nature</label>
            <select value={mon.nature} onChange={(e) => onUpdate({ nature: e.target.value })}
              className="mt-0.5 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm">
              <option value="">—</option>
              {NATURE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {isMixed && (
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400">Gender</label>
              <div className="mt-0.5 inline-flex rounded border border-[#d6c8a3] dark:border-stone-700 overflow-hidden">
                {['F', 'M'].map((gg) => (
                  <button key={gg} type="button" onClick={() => onUpdate({ gender: gg })}
                    className={`px-3 py-1 text-sm ${mon.gender === gg ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 dark:text-stone-400'}`}>{gg === 'F' ? '♀' : '♂'}</button>
                ))}
              </div>
            </div>
          )}
          <label className="inline-flex items-center gap-1 text-sm text-stone-700 dark:text-stone-300 mt-4">
            <input type="checkbox" checked={mon.shiny} onChange={(e) => onUpdate({ shiny: e.target.checked })} className="accent-yellow-500" /> Shiny
          </label>
          <label className="inline-flex items-center gap-1 text-sm text-stone-700 dark:text-stone-300 mt-4">
            <input type="checkbox" checked={mon.alpha} onChange={(e) => onUpdate({ alpha: e.target.checked })} className="accent-red-500" /> Alpha
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400">Level</label>
            <input type="number" min={1} max={100} value={mon.level ?? ''} placeholder="—"
              onChange={(e) => { const n = parseInt(e.target.value, 10); onUpdate({ level: n >= 1 && n <= 100 ? n : null }); }}
              className="mt-0.5 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm w-20" />
          </div>
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400">Held item</label>
            <input list="box-item-names" value={mon.item || ''} placeholder="None"
              onChange={(e) => onUpdate({ item: e.target.value })}
              className="mt-0.5 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm w-40" />
            <datalist id="box-item-names">
              {itemNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400">Nickname</label>
            <input value={mon.nickname || ''} placeholder={sp ? sp.name : '—'}
              onChange={(e) => onUpdate({ nickname: e.target.value })}
              className="mt-0.5 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm w-36" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-stone-500 dark:text-stone-400">Moves</label>
          <div className="mt-0.5 grid grid-cols-2 gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <input key={i} list="box-move-names" value={mon.moves?.[i] || ''} placeholder={`Move ${i + 1}`}
                onChange={(e) => onUpdate({ moves: [0, 1, 2, 3].map((j) => (j === i ? e.target.value : mon.moves?.[j] || '')) })}
                className="mt-0.5 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm" />
            ))}
          </div>
          <datalist id="box-move-names">
            {moveNames.map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs text-stone-500 dark:text-stone-400">Ability</label>
          <input list="box-ability-names" value={mon.ability || ''} placeholder="—"
            onChange={(e) => onUpdate({ ability: e.target.value })}
            className="mt-0.5 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm w-48" />
          <datalist id="box-ability-names">
            {(sp?.abilities || []).map((a) => <option key={a.name} value={a.name} />)}
          </datalist>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[#ece2c4] dark:border-stone-800/60">
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400">Move to box</label>
            <select value={mon.boxId} onChange={(e) => onMove(e.target.value)}
              className="mt-0.5 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm">
              {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={onDelete}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm self-end">
            <Trash2 size={14} /> Remove
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── small controls ── */

function Seg({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-md border border-[#d6c8a3] dark:border-stone-700 overflow-hidden text-xs">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-2.5 py-1.5 ${value === v ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 dark:text-stone-400 hover:bg-[#ece2c4] dark:hover:bg-stone-800'}`}>{label}</button>
      ))}
    </div>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md border text-xs ${on ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900' : 'border-[#d6c8a3] dark:border-stone-700 text-stone-600 dark:text-stone-300'}`}>{label}</button>
  );
}

