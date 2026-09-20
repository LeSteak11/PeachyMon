// The Progress header on the Tracker's first tab: overall completion, per
// region, per type, and the badge shelf. Pure presentation — everything is
// derived from the tracker state by lib/badges.js.

import { useEffect, useMemo, useState } from 'react';
import { Trophy, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import PokemonPicker from './PokemonPicker.jsx';
import PokemonSprite from './PokemonSprite.jsx';
import { topSpecies } from '../lib/catchLog.js';
import { buildBadges, syncEarned, loadEarned, BADGE_GROUPS } from '../lib/badges.js';
import { showToast } from '../lib/toast.js';

const TIER_RING = {
  bronze: 'border-amber-600/60 bg-amber-600/10 text-amber-800 dark:text-amber-500',
  silver: 'border-stone-400/70 bg-stone-400/10 text-stone-600 dark:text-stone-300',
  gold: 'border-yellow-500/70 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  platinum: 'border-cyan-400/70 bg-cyan-400/10 text-cyan-700 dark:text-cyan-300',
};

const pct = (have, need) => (need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0);

export default function TrackerProgress({ data, trackerState, catchLog, onLogCatch }) {
  const { stats, badges } = useMemo(
    () => buildBadges(data.pokemon, trackerState, catchLog),
    [data.pokemon, trackerState, catchLog]
  );
  const [logSpecies, setLogSpecies] = useState(null);
  const byId = useMemo(() => new Map(data.pokemon.map((p) => [p.id, p])), [data.pokemon]);
  const top = useMemo(() => (catchLog ? topSpecies(catchLog, 5) : []), [catchLog]);
  const [earned, setEarned] = useState(loadEarned);
  const [openBadges, setOpenBadges] = useState(false);

  // Stamp newly completed badges and celebrate them once.
  useEffect(() => {
    const { earned: next, fresh } = syncEarned(badges, earned);
    if (!fresh.length) return;
    setEarned(next);
    const names = fresh.map((id) => badges.find((b) => b.id === id)?.name).filter(Boolean);
    showToast(`Badge earned: ${names.join(', ')}`, { kind: 'success' });
  }, [badges]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = badges.filter((b) => b.done);
  const overall = pct(stats.caught, stats.total);
  // What you're closest to finishing — the nudge that makes the shelf useful.
  const nextUp = useMemo(
    () => badges.filter((b) => !b.done && b.have > 0)
      .sort((a, b) => b.have / b.need - a.have / a.need)
      .slice(0, 3),
    [badges]
  );

  return (
    <section className="rounded-md border border-[#e6dabf] dark:border-stone-800 bg-[#fdf8e9] dark:bg-stone-900 p-3 space-y-3">
      {/* Overall + regions */}
      <div className="flex items-center gap-4 flex-wrap">
        <Ring percent={overall} />
        <div>
          <div className="text-lg font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {stats.caught} <span className="text-sm font-normal text-stone-500">/ {stats.total} caught</span>
          </div>
          <div className="text-xs text-stone-500 dark:text-stone-400">
            {done.length} of {badges.length} badges earned
          </div>
        </div>
        <div className="flex-1 min-w-[260px] grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          {stats.regions.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <span className="w-12 text-[11px] text-stone-600 dark:text-stone-400">{r.label}</span>
              <Bar percent={pct(r.have, r.total)} />
              <span className="w-14 text-right text-[11px] tabular-nums text-stone-500">{r.have}/{r.total}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Catches ever — counted from captures, never reduced by transfers */}
      {catchLog && (
        <div className="flex items-center gap-2 flex-wrap text-xs border-t border-[#ece2c4] dark:border-stone-800/60 pt-2">
          <span className="text-stone-700 dark:text-stone-300 tabular-nums">
            <strong className="text-stone-900 dark:text-stone-100">{catchLog.total.toLocaleString()}</strong> caught in total
            {catchLog.shiny > 0 && <> · <span className="text-yellow-600 dark:text-yellow-400">{catchLog.shiny} shiny</span></>}
            {catchLog.alpha > 0 && <> · <span className="text-red-600 dark:text-red-400">{catchLog.alpha} alpha</span></>}
          </span>
          {top.length > 0 && (
            <span className="flex items-center gap-1 text-stone-500 dark:text-stone-400" title="Most caught">
              {top.map((t) => {
                const sp = byId.get(t.species);
                return sp ? (
                  <span key={t.species} className="inline-flex items-center" title={`${sp.name} ×${t.count}`}>
                    <PokemonSprite pokemon={sp} variant="still" loading="lazy" className="w-5 h-5 object-contain" />
                    <span className="tabular-nums text-[10px]">×{t.count}</span>
                  </span>
                ) : null;
              })}
            </span>
          )}
          {onLogCatch && (
            <span className="ml-auto flex items-center gap-1">
              <span className="w-44"><PokemonPicker pokemon={data.pokemon} value={logSpecies} onChange={setLogSpecies} placeholder="Log a catch…" /></span>
              <button
                type="button"
                disabled={logSpecies == null}
                onClick={() => { onLogCatch([{ species: logSpecies }]); showToast(`Logged a ${byId.get(logSpecies)?.name || 'catch'}.`); }}
                title="Count a catch you didn't capture into the Box"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#d6c8a3] dark:border-stone-700 bg-[#fdf8e9] dark:bg-stone-900 hover:bg-[#ece2c4] dark:hover:bg-stone-800 disabled:opacity-40"
              >
                <Plus size={12} /> 1
              </button>
            </span>
          )}
        </div>
      )}

      {/* Types */}
      <div className="flex flex-wrap gap-1">
        {stats.types.map((t) => (
          <span key={t.type} title={`${t.have} of ${t.total} ${t.type}-types caught`}
            className={`relative overflow-hidden rounded px-1.5 py-0.5 text-[10px] border tabular-nums ${
              t.have === t.total
                ? 'border-emerald-400 text-emerald-800 dark:text-emerald-300 bg-emerald-500/10'
                : 'border-[#e6dabf] dark:border-stone-800 text-stone-600 dark:text-stone-400'}`}>
            <span className="absolute inset-y-0 left-0 bg-blue-500/15" style={{ width: `${pct(t.have, t.total)}%` }} />
            <span className="relative">{t.type} {t.have}/{t.total}</span>
          </span>
        ))}
      </div>

      {/* Badges */}
      <div>
        <button type="button" onClick={() => setOpenBadges((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-300">
          {openBadges ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Trophy size={14} className="text-yellow-600 dark:text-yellow-500" />
          Badges <span className="font-normal normal-case tracking-normal text-stone-500">({done.length}/{badges.length})</span>
        </button>

        {!openBadges && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {done.slice(-6).map((b) => <BadgePill key={b.id} badge={b} earnedAt={earned[b.id]} />)}
            {nextUp.map((b) => <BadgePill key={b.id} badge={b} />)}
            {done.length === 0 && nextUp.length === 0 && (
              <span className="text-xs text-stone-500 dark:text-stone-400">Mark a Pokémon caught to start earning badges.</span>
            )}
          </div>
        )}

        {openBadges && (
          <div className="mt-2 space-y-3">
            {BADGE_GROUPS.map((g) => {
              const list = badges.filter((b) => b.group === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key}>
                  <div className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 mb-1">
                    {g.label} <span className="font-normal">({list.filter((b) => b.done).length}/{list.length})</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                    {list.map((b) => <BadgeCard key={b.id} badge={b} earnedAt={earned[b.id]} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Ring({ percent }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-[68px] h-[68px] shrink-0">
      <svg viewBox="0 0 68 68" className="w-full h-full -rotate-90">
        <circle cx="34" cy="34" r={r} className="stroke-[#ece2c4] dark:stroke-stone-800" strokeWidth="7" fill="none" />
        <circle cx="34" cy="34" r={r} className="stroke-blue-500" strokeWidth="7" fill="none"
          strokeDasharray={c} strokeDashoffset={c - (c * percent) / 100} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-stone-900 dark:text-stone-100 tabular-nums">
        {percent}%
      </span>
    </div>
  );
}

function Bar({ percent }) {
  return (
    <span className="flex-1 h-1.5 rounded bg-[#ece2c4] dark:bg-stone-800 overflow-hidden">
      <span className="block h-full bg-blue-500" style={{ width: `${percent}%` }} />
    </span>
  );
}

// Badge art is drop-in: save a square PNG as public/badges/<badge id>.png and
// it replaces the placeholder automatically — no code change. Missing files
// fall back to the medal/ring glyph, so a half-finished set still looks fine.
function BadgeIcon({ badge, size = 14 }) {
  const [failed, setFailed] = useState(false);
  const src = `${import.meta.env.BASE_URL}badges/${badge.id}.png`;
  if (failed) return <span style={{ fontSize: size }}>{badge.done ? '🏅' : '◌'}</span>;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size * 1.6, height: size * 1.6 }}
      className={`object-contain shrink-0 ${badge.done ? '' : 'opacity-40 grayscale'}`}
    />
  );
}

function BadgePill({ badge, earnedAt }) {
  const tip = badge.done
    ? `${badge.blurb}${earnedAt ? ` — earned ${new Date(earnedAt).toLocaleDateString()}` : ''}`
    : `${badge.blurb} (${badge.have}/${badge.need})`;
  return (
    <span title={tip}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        badge.done ? TIER_RING[badge.tier] : 'border-[#e6dabf] dark:border-stone-800 text-stone-500 dark:text-stone-500'}`}>
      <BadgeIcon badge={badge} size={11} /> {badge.name}
      {!badge.done && <span className="tabular-nums opacity-70">{badge.have}/{badge.need}</span>}
    </span>
  );
}

function BadgeCard({ badge, earnedAt }) {
  return (
    <div title={badge.blurb}
      className={`rounded-md border px-2 py-1.5 ${
        badge.done ? TIER_RING[badge.tier] : 'border-[#e6dabf] dark:border-stone-800 opacity-70'}`}>
      <div className="flex items-center gap-1 text-[11px] font-medium">
        <BadgeIcon badge={badge} size={13} />
        <span className="truncate text-stone-800 dark:text-stone-200">{badge.name}</span>
      </div>
      {badge.done ? (
        <div className="text-[10px] text-stone-500 dark:text-stone-400">
          {earnedAt ? `Earned ${new Date(earnedAt).toLocaleDateString()}` : 'Earned'}
        </div>
      ) : (
        <>
          <Bar percent={pct(badge.have, badge.need)} />
          <div className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400">{badge.have}/{badge.need}</div>
        </>
      )}
    </div>
  );
}
