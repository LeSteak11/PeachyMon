import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Crop, X } from 'lucide-react';
import {
  isDesktop, listWindows, captureAndOcr, listen, CAPTURE_HOTKEY_EVENT,
  flashToast, beep, primeAudio,
} from '../lib/desktop.js';
import { parseSummary, resolveSpecies, resolveName } from '../lib/breeding/parseSummary.js';
import { blankBoxMon } from '../lib/box.js';
import { showToast } from '../lib/toast.js';

const LS_RECT = 'pokemmo:capture:rect';
function loadRect() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_RECT));
    if (r && typeof r.x === 'number' && r.w > 0 && r.h > 0) return r;
  } catch { /* ignore */ }
  return null;
}
function saveRect(r) {
  try { localStorage.setItem(LS_RECT, JSON.stringify(r)); } catch { /* ignore */ }
}

// Desktop-only. Captures the PokéMMO window, OCRs the summary panel, and
// appends the parsed mon to the Box for inline confirm/correct. Renders nothing
// on the website.
// `target` = the mon open in the Box editor; while set, captures fill its IVs.
export default function CapturePanel({ data, onImport, onUpdate, target }) {
  if (!isDesktop()) return null;
  return <CapturePanelInner data={data} onImport={onImport} onUpdate={onUpdate} target={target} />;
}

function CapturePanelInner({ data, onImport, onUpdate, target }) {
  const [windows, setWindows] = useState([]);
  const [hwnd, setHwnd] = useState(null);
  const [status, setStatus] = useState(null); // { kind:'ok'|'warn'|'err', msg }
  const [busy, setBusy] = useState(false);
  const [rect, setRect] = useState(loadRect);
  const [calibSrc, setCalibSrc] = useState(null); // data URL while calibrating
  const [preview, setPreview] = useState(null);    // { src, gender, shiny, alpha }

  const refresh = useCallback(async () => {
    try {
      const list = await listWindows();
      setWindows(list || []);
      const guess = (list || []).find((w) => /pok[eé]mmo/i.test(w.title));
      if (guess) setHwnd((h) => h ?? guess.hwnd);
    } catch (e) {
      setStatus({ kind: 'err', msg: String(e?.message || e) });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // OCR rows pick up the type badge level with them ("Tackle normal",
  // "Torrent water"), so match the longest leading run of words that is a real
  // name; fall back to the raw text.
  const resolvePrefix = (text, names, maxWords = 3) => {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    for (let n = Math.min(maxWords, words.length); n >= 1; n--) {
      const hit = resolveName(words.slice(0, n).join(' '), names);
      if (hit) return hit;
    }
    return null;
  };

  const doCapture = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus({ kind: 'ok', msg: 'Capturing…' });
    try {
      // Restarting PokéMMO invalidates the stored window handle, so re-find the
      // window (once) instead of failing with "invalid window handle".
      const findPokemmo = async () => {
        const list = (await listWindows()) || [];
        setWindows(list);
        const guess = list.find((w) => /pok[eé]mmo/i.test(w.title));
        if (guess) setHwnd(guess.hwnd);
        return guess?.hwnd ?? null;
      };
      let useHwnd = hwnd ?? (await findPokemmo());
      if (!useHwnd) {
        beep(false);
        setStatus({ kind: 'warn', msg: 'PokéMMO window not found — start PokéMMO (borderless-windowed), then hit ↻ and pick it.' });
        return;
      }
      let payload;
      try {
        payload = await captureAndOcr({ hwnd: useHwnd, rect: rect || null });
      } catch (err) {
        if (!/handle|not found|invalid/i.test(String(err?.message || err))) throw err;
        const fresh = await findPokemmo();
        if (!fresh) {
          beep(false);
          setStatus({ kind: 'warn', msg: 'PokéMMO window not found — is PokéMMO still running?' });
          return;
        }
        payload = await captureAndOcr({ hwnd: fresh, rect: rect || null });
        setStatus({ kind: 'ok', msg: 'Reconnected to the PokéMMO window.' });
      }
      const parsed = parseSummary(payload);
      const isIvPage = parsed.page === 'ivs';
      const isMovesPage = parsed.page === 'moves';
      const nameOf = (id) => data.pokemon.find((p) => p.id === id)?.name || null;
      const byDex = parsed.dexNum && data.pokemon.some((p) => p.id === parsed.dexNum) ? parsed.dexNum : null;
      const species = byDex ?? resolveSpecies(parsed.speciesName, data.pokemon);
      const speciesName = nameOf(species);
      // Held item → the dataset's canonical spelling when OCR matches one.
      const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
      const item = parsed.item == null ? null
        : parsed.item === '' ? ''
        : (Object.values(data.items).find((i) => norm(i.name) === norm(parsed.item))?.name || parsed.item);
      // Nickname only when it differs from the species name.
      const nickname = parsed.nickname == null ? null
        : speciesName && norm(parsed.nickname) === norm(speciesName) ? '' : parsed.nickname;
      // (an unnamed mon's "Name:" row just repeats its species)

      // A mon is open in the Box editor → update it with whatever this screen
      // shows (level + item on every tab; IVs on the IV tab; nature/nickname on
      // the info tab) and report exactly what changed.
      if (target) {
        const name = nameOf(target.species) || 'mon';
        // Only a sure read (dex number or exact name) may block the update.
        const sure = byDex ?? data.pokemon.find((p) => norm(p.name) === norm(parsed.speciesName || ''))?.id ?? null;
        // …unless the open mon evolved into it (level-ups do that).
        const evolvedInto = (from, to, seen = new Set()) => {
          if (seen.has(from)) return false; seen.add(from);
          const evos = data.pokemon.find((p) => p.id === from)?.evolutions || [];
          return evos.some((e) => e.id === to || evolvedInto(e.id, to, seen));
        };
        const evolved = sure && target.species && sure !== target.species && evolvedInto(target.species, sure);
        if (sure && target.species && sure !== target.species && !evolved) {
          beep(false);
          flashToast(`That's ${nameOf(sure)}, not ${name} — close the open mon first`, false);
          setStatus({ kind: 'warn', msg: `That summary is ${nameOf(sure)}, but ${name} is open. Close it (or open ${nameOf(sure)}) and try again.` });
          return;
        }
        // Nothing usable on screen: not the IV tab, not the moves tab, and no
        // nature or level read anywhere.
        if (!isIvPage && !isMovesPage && !parsed.nature && parsed.level == null) {
          beep(false);
          flashToast('Couldn\'t read the summary — try again', false);
          setStatus({
            kind: 'warn',
            msg: `Couldn't read a summary screen — make sure it's open and inside the calibrated box. Read: "${String(payload.text || '').replace(/\s+/g, ' ').slice(0, 160)}"`,
          });
          return;
        }
        const patch = {};
        const changes = [];
        if (evolved) { patch.species = sure; changes.push(`evolved into ${nameOf(sure)}`); }
        else if (!target.species && species) { patch.species = species; changes.push(`species → ${speciesName}`); }
        if (parsed.level != null && parsed.level !== target.level) {
          patch.level = parsed.level;
          changes.push(target.level ? `Lv. ${target.level} → ${parsed.level}` : `Lv. ${parsed.level}`);
        }
        if (item != null && item !== (target.item || '')) {
          patch.item = item;
          changes.push(`item → ${item || 'none'}`);
        }
        if (isIvPage) {
          const ivs = { ...blankBoxMon().ivs, ...parsed.ivs };
          if (Object.keys(ivs).some((k) => ivs[k] !== target.ivs?.[k])) { patch.ivs = ivs; changes.push('IVs'); }
        } else if (isMovesPage) {
          // Moves the species can learn are tried first (disambiguates close
          // OCR misreads), then every move; an unresolved read is kept as-is.
          const sp = data.pokemon.find((p) => p.id === (patch.species ?? target.species));
          const learnable = [...new Set(Object.values(sp?.moves || {}).flat().map((m) => data.moves[m.id]?.name).filter(Boolean))];
          const allMoves = Object.values(data.moves).map((m) => m.name);
          const moves = (parsed.moves || []).map((t) => resolvePrefix(t, learnable) || resolvePrefix(t, allMoves) || t);
          while (moves.length < 4) moves.push('');
          const before = [...(target.moves || []), '', '', '', ''].slice(0, 4);
          if (moves.some((m, i) => m !== before[i])) {
            patch.moves = moves;
            changes.push(`moves → ${moves.filter(Boolean).join(', ') || 'none'}`);
          }
          // The ability row can pick up the type badge sitting level with it
          // ("Torrent water"), so match the longest leading run of words that
          // is a real ability (abilities are at most 3 words).
          const abilityNames = Object.values(data.abilities).map((a) => a.name);
          const ability = parsed.ability
            && (resolvePrefix(parsed.ability, abilityNames) || String(parsed.ability).split(/\s+/)[0]);
          if (ability && ability !== target.ability) { patch.ability = ability; changes.push(`ability → ${ability}`); }
        } else {
          if (parsed.nature && parsed.nature !== target.nature) { patch.nature = parsed.nature; changes.push(`nature → ${parsed.nature}`); }
          if (nickname != null && nickname !== (target.nickname || '')) { patch.nickname = nickname; changes.push(nickname ? `nickname → ${nickname}` : 'nickname cleared'); }
        }
        if (!changes.length) {
          beep(true);
          flashToast(`${name}: up to date — nothing changed ✓`, true);
          showToast(`${name} is already up to date — nothing changed.`);
          setStatus({ kind: 'ok', msg: `${name}: checked — nothing changed.` });
          return;
        }
        onUpdate(target.id, patch);
        beep(true);
        flashToast(`${name} updated: ${changes.join(', ')} ✓`, true);
        showToast(`${name} updated: ${changes.join(', ')}.`);
        setStatus({ kind: 'ok', msg: `${name} updated: ${changes.join(', ')}.` });
        return;
      }

      // Nothing open → a new mon from the info screen.
      if (isIvPage || isMovesPage) {
        const what = isIvPage ? 'IVs' : 'moves';
        beep(false);
        flashToast(`Open the mon in your Box first, then capture ${what}`, false);
        setStatus({ kind: 'warn', msg: `That was the ${what} screen. Capture the info screen to add a mon, then click it in the Box and capture the ${what} screen.` });
        return;
      }
      const gender = payload.gender || parsed.gender || 'F';

      const mon = {
        ...blankBoxMon(),
        species,
        gender,
        ivs: { ...blankBoxMon().ivs, ...parsed.ivs },
        nature: parsed.nature || '',
        level: parsed.level,
        item: item || '',
        nickname: nickname || '',
        shiny: !!payload.shiny,
        alpha: !!payload.alpha,
        source: 'capture',
        addedAt: new Date().toISOString(),
      };
      onImport([mon]);

      const clean = !!(species && parsed.nature);
      const name = speciesName || 'unknown mon';
      const marks = [payload.shiny && 'shiny', payload.alpha && 'alpha'].filter(Boolean).join(' ');
      beep(clean);
      flashToast(`Added ${name}${marks ? ` (${marks})` : ''} ${clean ? '✓' : '— check it'}`, clean);

      setPreview({
        src: `data:image/png;base64,${payload.pngBase64}`,
        gender, shiny: !!payload.shiny, alpha: !!payload.alpha,
      });
      const bits = [speciesName || 'species?'];
      if (parsed.level) bits.push(`Lv. ${parsed.level}`);
      bits.push(parsed.nature || 'nature?');
      bits.push(gender === 'M' ? '♂' : gender === 'F' ? '♀' : gender);
      if (marks) bits.push(marks);
      const seen = !species ? ` Read: "${String(payload.text || '').replace(/\s+/g, ' ').slice(0, 120)}"` : '';
      setStatus({ kind: clean ? 'ok' : 'warn', msg: `Added (${bits.join(' · ')}). Click it below, then capture the IV screen to fill IVs.${seen}` });
    } catch (e) {
      beep(false);
      setStatus({ kind: 'err', msg: `Capture failed: ${String(e?.message || e)}` });
    } finally {
      setBusy(false);
    }
  }, [busy, hwnd, rect, data, onImport, onUpdate, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const startCalibrate = useCallback(async () => {
    if (!hwnd) { setStatus({ kind: 'warn', msg: 'Pick the PokéMMO window first.' }); return; }
    primeAudio();
    setBusy(true);
    setStatus({ kind: 'ok', msg: 'Capturing for calibration…' });
    try {
      const payload = await captureAndOcr({ hwnd }); // full window, uncropped
      setCalibSrc(`data:image/png;base64,${payload.pngBase64}`);
      setStatus(null);
    } catch (e) {
      setStatus({ kind: 'err', msg: `Capture failed: ${String(e?.message || e)}` });
    } finally {
      setBusy(false);
    }
  }, [hwnd]);

  // Global hotkey → capture. Ref keeps the listener calling the latest closure.
  const captureRef = useRef(doCapture);
  captureRef.current = doCapture;
  useEffect(() => {
    let unlisten = null;
    listen(CAPTURE_HOTKEY_EVENT, () => captureRef.current()).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  const dot = status?.kind === 'err' ? 'text-red-600 dark:text-red-400'
            : status?.kind === 'warn' ? 'text-amber-700 dark:text-amber-400'
            : 'text-stone-600 dark:text-stone-300';

  return (
    <div className="rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Camera size={15} className="text-blue-700 dark:text-blue-300 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-200">Capture from game</span>
        <span className="ml-auto text-[10px] text-blue-700/70 dark:text-blue-300/70">desktop</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={hwnd ?? ''}
          onChange={(e) => { primeAudio(); setHwnd(e.target.value ? Number(e.target.value) : null); }}
          className="flex-1 min-w-0 px-2 py-1 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-800 dark:text-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select the PokéMMO window…</option>
          {windows.map((w) => (
            <option key={w.hwnd} value={w.hwnd}>{w.title || `Window ${w.hwnd}`}</option>
          ))}
        </select>
        <button type="button" onClick={refresh} title="Refresh window list"
          className="p-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
          <RefreshCw size={13} />
        </button>
        <button type="button" onClick={startCalibrate} disabled={busy} title="Mark where the summary panel is"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 text-stone-700 dark:text-stone-300 text-xs disabled:opacity-50">
          <Crop size={13} /> Calibrate
        </button>
        <button type="button" onClick={doCapture} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed">
          <Camera size={14} /> {busy ? '…' : 'Capture'}
        </button>
      </div>

      <div className="text-[11px] text-blue-800/80 dark:text-blue-200/80 leading-snug">
        Open a mon's summary in-game, then capture (or press <kbd className="px-1 rounded bg-blue-100 dark:bg-blue-900/60">Ctrl+Shift+B</kbd>).
        Run PokéMMO <strong>borderless-windowed</strong>.{' '}
        {rect
          ? <span className="text-emerald-700 dark:text-emerald-400">Panel region calibrated ✓</span>
          : <span className="text-amber-700 dark:text-amber-400">Not calibrated — alpha/shiny &amp; gender need you to <strong>Calibrate</strong> the panel region once.</span>}
      </div>

      {status && <div className={`text-[11px] ${dot}`}>{status.msg}</div>}

      {preview && (
        <div className="flex items-start gap-2 pt-1">
          <img src={preview.src} alt="last capture" className="w-16 rounded border border-[#d6c8a3] dark:border-stone-700" />
          <div className="text-[10px] text-stone-600 dark:text-stone-400 leading-tight">
            <div>Last capture:</div>
            <div>{preview.gender === 'M' ? '♂ male' : preview.gender === 'F' ? '♀ female' : preview.gender}</div>
            <div>{preview.shiny ? '★ shiny' : 'not shiny'} · {preview.alpha ? 'α alpha' : 'not alpha'}</div>
          </div>
        </div>
      )}

      {calibSrc && (
        <CalibrateOverlay
          src={calibSrc}
          initialRect={rect}
          onSave={(r) => { setRect(r); saveRect(r); setCalibSrc(null); setStatus({ kind: 'ok', msg: 'Panel region saved. Capture again to use it.' }); }}
          onCancel={() => setCalibSrc(null)}
        />
      )}
    </div>
  );
}

// Full-screen overlay: drag a rectangle over the captured screenshot to mark
// the summary-panel region. Coordinates are normalized (0..1) to the image so
// the Rust side can crop any future capture to exactly that area.
function CalibrateOverlay({ src, initialRect, onSave, onCancel }) {
  const imgRef = useRef(null);
  const dragStart = useRef(null);
  const [sel, setSel] = useState(initialRect || null);

  const toNorm = (clientX, clientY) => {
    const r = imgRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  };
  const onDown = (e) => {
    e.preventDefault();
    const p = toNorm(e.clientX, e.clientY);
    dragStart.current = p;
    setSel({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e) => {
    if (!dragStart.current) return;
    const p = toNorm(e.clientX, e.clientY);
    const a = dragStart.current;
    setSel({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
  };
  const onUp = () => { dragStart.current = null; };

  const valid = sel && sel.w > 0.02 && sel.h > 0.02;

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex flex-col items-center justify-center p-4" onMouseUp={onUp} onMouseMove={onMove}>
      <div className="text-white text-sm mb-2">Drag a box around the <strong>summary panel</strong> (name, stats, IVs).</div>
      <div className="relative max-w-full max-h-[78vh] select-none">
        <img
          ref={imgRef}
          src={src}
          alt="calibration"
          draggable={false}
          onMouseDown={onDown}
          className="max-w-full max-h-[78vh] object-contain cursor-crosshair rounded"
        />
        {sel && (
          <div
            className="absolute border-2 border-emerald-400 bg-emerald-400/15 pointer-events-none"
            style={{
              left: `${sel.x * 100}%`, top: `${sel.y * 100}%`,
              width: `${sel.w * 100}%`, height: `${sel.h * 100}%`,
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={onCancel}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-stone-500 text-stone-200 hover:bg-white/10 text-sm">
          <X size={14} /> Cancel
        </button>
        <button type="button" disabled={!valid} onClick={() => onSave(sel)}
          className="inline-flex items-center gap-1 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed">
          Save region
        </button>
      </div>
    </div>
  );
}
