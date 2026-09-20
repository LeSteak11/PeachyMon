import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, Plus, Trash2, Pencil, Check, X, Copy, Download, Upload, Package, Swords } from 'lucide-react';
import PokemonPicker from '../components/PokemonPicker.jsx';
import PokemonSprite from '../components/PokemonSprite.jsx';
import TypeBadge from '../components/TypeBadge.jsx';
import Modal from '../components/Modal.jsx';
import {
  blankSet, teamById, addTeam, renameTeam, deleteTeam, duplicateTeam, setActiveTeam,
  addMember, updateMember, removeMember, setTeamMembers,
  teamToShowdown, teamFromShowdown, storeToJSON, normalizeStore, MAX_MEMBERS,
} from '../lib/teams.js';
import { allMons } from '../lib/box.js';
import {
  NATURE_NAMES, TYPES, BASE_KEY, calcStat, weaknessMatrix, offensiveCoverage, speedTiers,
} from '../lib/teamAnalysis.js';
import { downloadText } from '../lib/desktop.js';

const EV_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const EV_LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default function TeamBuilder({ data, store, setStore, boxStore, theme, onTheme }) {
  const navigate = useNavigate();
  const byId = useMemo(() => new Map(data.pokemon.map((p) => [p.id, p])), [data.pokemon]);
  const itemNames = useMemo(() => [...new Set(Object.values(data.items).map((i) => i.name).filter(Boolean))].sort(), [data.items]);
  const moveByName = useMemo(() => new Map(Object.values(data.moves).map((m) => [norm(m.name), m])), [data.moves]);
  const speciesByNorm = useMemo(() => new Map(data.pokemon.map((p) => [norm(p.name), p.id])), [data.pokemon]);

  const team = teamById(store, store.activeTeamId) || store.teams[0];
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [boxPick, setBoxPick] = useState(false);
  const fileRef = useRef(null);

  /* handlers */
  const upd = (setId, patch) => setStore((s) => updateMember(s, team.id, setId, patch));
  const addBlank = () => setStore((s) => addMember(s, team.id, blankSet()));
  const addFromBox = (bm) => { setStore((s) => addMember(s, team.id, { ...blankSet(), monId: bm.species, ivs: { ...bm.ivs }, nature: bm.nature || 'Hardy', level: bm.level || 100, item: bm.item || '', ability: bm.ability || '', moves: [0, 1, 2, 3].map((i) => bm.moves?.[i] || ''), gender: ['M', 'F'].includes(bm.gender) ? bm.gender : '' })); setBoxPick(false); };
  const exportShowdown = () => downloadText(teamToShowdown(team, (id) => byId.get(id)?.name || 'Unknown'), `${team.name.replace(/\s+/g, '_')}.txt`);
  const exportJSON = () => downloadText(storeToJSON(store), 'pokemmo-teams.json');
  const doImport = () => {
    const { members, error } = teamFromShowdown(importText, (name) => speciesByNorm.get(norm(name)) ?? null);
    if (error || !members) { window.alert(error || 'Could not parse.'); return; }
    setStore((s) => setTeamMembers(s, team.id, members));
    setImportOpen(false); setImportText('');
  };
  const importJSONFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { try { const st = normalizeStore(JSON.parse(String(r.result || ''))); setStore((s) => ({ ...s, teams: [...s.teams, ...st.teams], activeTeamId: st.teams[0]?.id || s.activeTeamId })); } catch { window.alert('Invalid teams JSON.'); } };
    r.readAsText(file);
  };
  const toCalc = (set) => {
    try { sessionStorage.setItem('pokemmo:calc:prefill', JSON.stringify(set)); } catch { /* ignore */ }
    navigate('/damage');
  };

  // Analysis inputs.
  const aMembers = useMemo(() => team.members.map((m) => {
    const p = m.monId != null ? byId.get(m.monId) : null;
    if (!p) return null;
    const spe = calcStat('spe', p.stats[BASE_KEY.spe], m.ivs.spe, m.evs.spe, m.level, m.nature);
    const attackTypes = m.moves.filter(Boolean).map((mn) => moveByName.get(norm(mn))).filter((mv) => mv && mv.damage_class !== 'STATUS' && mv.power).map((mv) => mv.type.toLowerCase());
    return { name: p.name, types: p.types, spe, attackTypes };
  }).filter(Boolean), [team.members, byId, moveByName]);

  const btn = 'inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 text-xs';

  return (
    <main className="max-w-7xl mx-auto px-4 py-4">
      <header className="flex items-center gap-3 mb-3 flex-wrap">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Team Builder</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => setImportOpen(true)} className={btn}><Upload size={13} /> Import</button>
          <button type="button" onClick={exportShowdown} className={btn}><Download size={13} /> Showdown</button>
          <button type="button" onClick={exportJSON} className={btn}>JSON</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { importJSONFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')} className="p-1.5 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-200">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button>
        </div>
      </header>

      {/* Team tabs */}
      <div className="flex items-center gap-1 flex-wrap border-b border-[#e6dabf] dark:border-stone-800 pb-2 mb-3">
        {store.teams.map((t) => {
          const active = t.id === team.id;
          return (
            <span key={t.id} className={`group inline-flex items-center rounded-t-md -mb-2 border-b-2 ${active ? 'border-blue-500' : 'border-transparent'}`}>
              {active && editingName ? (
                <span className="inline-flex items-center gap-1 px-1">
                  <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setStore((s) => renameTeam(s, t.id, nameDraft)); setEditingName(false); } if (e.key === 'Escape') setEditingName(false); }} className="w-28 px-1.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-sm" />
                  <button type="button" onClick={() => { setStore((s) => renameTeam(s, t.id, nameDraft)); setEditingName(false); }} className="p-0.5 text-emerald-600"><Check size={13} /></button>
                </span>
              ) : (
                <>
                  <button type="button" onClick={() => setStore((s) => setActiveTeam(s, t.id))} className={`pl-3 ${active ? 'pr-1' : 'pr-3'} py-1.5 text-sm font-medium ${active ? 'text-blue-600 dark:text-blue-400' : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'}`}>
                    {t.name}<span className="ml-1 text-[10px] text-stone-400">{t.members.length}</span>
                  </button>
                  {active && (
                    <span className="flex items-center pr-1.5">
                      <button type="button" onClick={() => { setNameDraft(t.name); setEditingName(true); }} className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"><Pencil size={12} /></button>
                      <button type="button" onClick={() => setStore((s) => duplicateTeam(s, t.id))} title="Duplicate" className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"><Copy size={12} /></button>
                      {store.teams.length > 1 && <button type="button" onClick={() => { if (window.confirm(`Delete "${t.name}"?`)) setStore((s) => deleteTeam(s, t.id)); }} className="p-0.5 text-stone-400 hover:text-red-600"><Trash2 size={12} /></button>}
                    </span>
                  )}
                </>
              )}
            </span>
          );
        })}
        <button type="button" onClick={() => setStore((s) => addTeam(s))} className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-[#ece2c4] dark:hover:bg-stone-800"><Plus size={15} /></button>
      </div>

      {/* Members */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {team.members.map((m) => (
          <SetEditor key={m.id} set={m} poke={m.monId != null ? byId.get(m.monId) : null} data={data} itemNames={itemNames}
            onChange={(patch) => upd(m.id, patch)} onRemove={() => setStore((s) => removeMember(s, team.id, m.id))} onToCalc={() => toCalc(m)} />
        ))}
        {team.members.length < MAX_MEMBERS && (
          <div className="rounded-md border border-dashed border-[#d6c8a3] dark:border-stone-700 p-4 flex flex-col items-center justify-center gap-2 min-h-[160px]">
            <button type="button" onClick={addBlank} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm"><Plus size={14} /> Add Pokémon</button>
            <button type="button" onClick={() => setBoxPick(true)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#d6c8a3] dark:border-stone-700 text-xs text-stone-600 dark:text-stone-300"><Package size={12} /> From Box</button>
          </div>
        )}
      </div>

      {/* Analysis */}
      {aMembers.length > 0 && (
        <div className="mt-4 grid lg:grid-cols-2 gap-3">
          <WeaknessChart members={aMembers} />
          <div className="space-y-3">
            <CoverageChart members={aMembers} />
            <SpeedTiers members={aMembers} />
          </div>
        </div>
      )}

      {importOpen && (
        <Modal title="Import team (Showdown / PokéPaste)" onClose={() => setImportOpen(false)} maxWidth="max-w-lg">
          <div className="p-4 space-y-2">
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={12} placeholder={"Tyranitar @ Choice Band\nAbility: Sand Stream\nEVs: 252 Atk / 4 HP / 252 Spe\nAdamant Nature\n- Crunch\n- Stone Edge\n..."} className="w-full px-2 py-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setImportOpen(false)} className={btn}>Cancel</button>
              <button type="button" onClick={doImport} className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm">Replace team</button>
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">…or import a teams JSON file</button>
          </div>
        </Modal>
      )}

      {boxPick && (
        <Modal title="Add from your Box" onClose={() => setBoxPick(false)} maxWidth="max-w-md">
          <BoxPickList boxStore={boxStore} byId={byId} onPick={addFromBox} />
        </Modal>
      )}
    </main>
  );
}

/* ── set editor ── */
function SetEditor({ set, poke, data, itemNames, onChange, onRemove, onToCalc }) {
  const setStat = (group, k, v) => onChange({ [group]: { ...set[group], [k]: v } });
  const setMove = (i, v) => onChange({ moves: set.moves.map((x, j) => (j === i ? v : x)) });
  const abilityOpts = poke?.abilities?.map((a) => a.name) || [];
  const moveOpts = useMemo(() => learnsetNames(poke, data), [poke, data]);
  const evTotal = EV_KEYS.reduce((s, k) => s + (Number(set.evs[k]) || 0), 0);

  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0"><PokemonPicker pokemon={data.pokemon} value={set.monId} onChange={(id) => onChange({ monId: id })} placeholder="Pick Pokémon" /></div>
        <button type="button" onClick={onToCalc} title="Test in Damage Calc" className="p-1 rounded text-stone-400 hover:text-blue-600"><Swords size={14} /></button>
        <button type="button" onClick={onRemove} title="Remove" className="p-1 rounded text-stone-400 hover:text-red-600"><X size={14} /></button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Combo label="Item" value={set.item} onChange={(v) => onChange({ item: v })} options={itemNames} listId={`${set.id}-item`} />
        <Sel label="Ability" value={set.ability} onChange={(v) => onChange({ ability: v })} options={['', ...abilityOpts]} />
        <Sel label="Nature" value={set.nature} onChange={(v) => onChange({ nature: v })} options={NATURE_NAMES} />
        <label className="text-[11px] text-stone-500 dark:text-stone-400">Level<input type="number" min="1" max="100" value={set.level} onChange={(e) => onChange({ level: clamp(e.target.value, 1, 100, 100) })} className={inp} /></label>
      </div>

      <div className="grid grid-cols-6 gap-1">
        {EV_KEYS.map((k) => (
          <div key={k} className="text-center">
            <div className="text-[9px] uppercase text-stone-400">{EV_LABEL[k]}</div>
            <input type="number" min="0" max="252" step="4" value={set.evs[k]} onChange={(e) => setStat('evs', k, clamp(e.target.value, 0, 252, 0))} title="EV" className={mini} />
            <input type="number" min="0" max="31" value={set.ivs[k]} onChange={(e) => setStat('ivs', k, clamp(e.target.value, 0, 31, 31))} title="IV" className={`${mini} mt-0.5 text-stone-500`} />
          </div>
        ))}
      </div>
      <div className={`text-[9px] text-right ${evTotal > 510 ? 'text-red-500' : 'text-stone-400'}`}>EV {evTotal}/510 · IV row below</div>

      <div className="space-y-1">
        {set.moves.map((mv, i) => (
          <div key={i}>
            <input list={`${set.id}-mv-${i}`} value={mv} onChange={(e) => setMove(i, e.target.value)} placeholder={`Move ${i + 1}`} className="w-full px-1.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <datalist id={`${set.id}-mv-${i}`}>{moveOpts.map((o) => <option key={o} value={o} />)}</datalist>
          </div>
        ))}
      </div>
    </section>
  );
}

function BoxPickList({ boxStore, byId, onPick }) {
  const mons = allMons(boxStore).filter((m) => m.species != null);
  if (!mons.length) return <div className="p-4 text-sm text-stone-500 dark:text-stone-400">Your Box is empty. Add mons on the Box tab first.</div>;
  return (
    <ul className="divide-y divide-[#ece2c4] dark:divide-stone-800/60">
      {mons.map((m) => {
        const p = byId.get(m.species);
        return (
          <li key={m.id}>
            <button type="button" onClick={() => onPick(m)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#f1e9d2] dark:hover:bg-stone-800/40 text-left">
              {p && <PokemonSprite pokemon={p} variant="animated" loading="lazy" className="w-8 h-8 object-contain" />}
              <span className="flex-1 text-sm text-stone-800 dark:text-stone-200">{p ? p.name : 'Unknown'}</span>
              <span className="text-[11px] text-stone-400">{m.nature || ''} {m.gender === 'M' ? '♂' : m.gender === 'F' ? '♀' : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ── analysis panels ── */
function WeaknessChart({ members }) {
  const matrix = useMemo(() => weaknessMatrix(members), [members]);
  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Defensive weaknesses</h2>
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full">
          <thead><tr>
            <th className="text-left font-normal pb-1"></th>
            {members.map((m, i) => <th key={i} className="px-0.5 font-normal text-stone-500 truncate max-w-[60px]">{m.name.slice(0, 6)}</th>)}
            <th className="px-1 font-normal text-stone-400">⚠</th>
          </tr></thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.type} className={row.weak >= 2 ? 'bg-red-50/60 dark:bg-red-950/20' : ''}>
                <td className="py-0.5"><TypeBadge type={row.type} /></td>
                {row.members.map((c, i) => <td key={i} className={`text-center tabular-nums ${multCls(c.mult)}`}>{multLbl(c.mult)}</td>)}
                <td className={`text-center font-semibold ${row.weak >= 2 ? 'text-red-600 dark:text-red-400' : 'text-stone-400'}`}>{row.weak || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function CoverageChart({ members }) {
  const cov = useMemo(() => offensiveCoverage(members), [members]);
  const gaps = cov.filter((c) => c.best <= 1);
  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Offensive coverage</h2>
      <div className="flex flex-wrap gap-1">
        {cov.map((c) => (
          <span key={c.type} className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] ${c.best >= 2 ? 'opacity-100' : 'opacity-40'}`} title={c.best >= 2 ? `super-effective via ${c.hitter}` : 'not super-effective'}>
            <TypeBadge type={c.type} />{c.best >= 2 && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{c.best}×</span>}
          </span>
        ))}
      </div>
      {gaps.length > 0 && <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">No super-effective hit vs: {gaps.map((g) => cap(g.type)).join(', ')}</div>}
    </section>
  );
}
function SpeedTiers({ members }) {
  const tiers = useMemo(() => speedTiers(members), [members]);
  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Speed tiers</h2>
      <table className="text-xs w-full">
        <thead><tr className="text-stone-400"><th className="text-left font-normal">Pokémon</th><th className="text-right font-normal">Speed</th><th className="text-right font-normal">+1 / Scarf</th></tr></thead>
        <tbody>
          {tiers.map((t, i) => (
            <tr key={i} className="border-t border-[#ece2c4] dark:border-stone-800/60">
              <td className="py-0.5 text-stone-800 dark:text-stone-200">{t.name}</td>
              <td className="text-right tabular-nums font-semibold text-stone-700 dark:text-stone-300">{t.base}</td>
              <td className="text-right tabular-nums text-stone-500">{t.plus1}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ── helpers ── */
function learnsetNames(poke, data) {
  if (!poke?.moves) return [];
  const ids = new Set();
  for (const v of Object.values(poke.moves)) if (Array.isArray(v)) for (const m of v) ids.add(typeof m === 'object' ? m.id : m);
  return [...new Set([...ids].map((id) => data.moves[id]?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
const inp = 'mt-0.5 w-full px-1.5 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500';
const mini = 'w-full px-0.5 py-0.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-[10px] tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-blue-500';
function Sel({ label, value, onChange, options }) {
  return <label className="text-[11px] text-stone-500 dark:text-stone-400">{label}<select value={value} onChange={(e) => onChange(e.target.value)} className={inp}>{options.map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select></label>;
}
function Combo({ label, value, onChange, options, listId }) {
  return <label className="text-[11px] text-stone-500 dark:text-stone-400">{label}<input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" className={inp} /><datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist></label>;
}
function multCls(m) {
  if (m === 0) return 'text-indigo-500 font-semibold';
  if (m > 2) return 'text-red-700 dark:text-red-300 font-bold';
  if (m > 1) return 'text-orange-600 dark:text-orange-400 font-semibold';
  if (m < 0.5) return 'text-teal-600 dark:text-teal-400';
  if (m < 1) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-stone-300 dark:text-stone-600';
}
function multLbl(m) {
  if (m === 0) return '0';
  if (m === 0.25) return '¼';
  if (m === 0.5) return '½';
  if (m === 1) return '·';
  if (m === 4) return '4×';
  return `${m}×`;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function clamp(raw, lo, hi, def) { let n = Math.round(Number(raw)); if (!Number.isFinite(n)) n = def; return Math.min(hi, Math.max(lo, n)); }
