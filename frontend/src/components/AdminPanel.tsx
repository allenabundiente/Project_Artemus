import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { AdminAccount, AuditEntry, FeatureRow, GuildAdminInfo, MapConfig, RosterEntry, ShopItem, ThemeMeta } from '../types';
import { spriteDataUrl, isCanonicalSprite } from '../game/sprites';
import { SPRITES } from '../game/spriteGrids';
import { THEMES } from '../game/themes';
import { AVATAR_GRIDS } from '../game/avatarGrids';
import { spriteApiUrl, refreshSpriteVersions, onSpriteVersions } from '../game/spriteVersions';
import type { AnimDef, CustomThemePayload } from '../api';
import GuildSettings from './GuildSettings';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';

type Tab = 'features' | 'guilds' | 'admins' | 'audit' | 'sprites' | 'animations' | 'themes' | 'map' | 'shop';

const FEATURES_HELP: Record<string, string> = {
  shop: 'The Royal Shop (players spend coins)',
  wardrobe: 'Character customization',
  leaderboard: 'Term & global leaderboards',
  admin_panel: 'The admin panel itself',
  llm_generation: 'AI challenge generation',
};

// --- feature locks -------------------------------------------------------------

function FeaturesTab() {
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => { api.getFeatures().then(setRows).catch(() => setRows([])); }, []);
  useEffect(refresh, [refresh]);

  async function toggle(row: FeatureRow) {
    setBusy(row.key);
    try {
      const updated = await api.setFeatureLock(row.key, !row.locked);
      setRows((rs) => rs.map((r) => (r.key === updated.key ? updated : r)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>🔒 FEATURE LOCKS</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Locking hides an area from students and teachers behind the royal decree.
        Use it to pull unstable updates without a redeploy.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((row) => (
          <li key={row.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <p className="pixel-font" style={{ fontSize: '0.65rem', margin: 0 }}>{row.label}</p>
              <p className="term-font" style={{ fontSize: '0.85rem', margin: 0, color: 'var(--d-stone-light)' }}>{FEATURES_HELP[row.key] ?? row.key}</p>
            </div>
            <button
              className={`pixel-btn ${row.locked ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
              style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
              onClick={() => void toggle(row)}
              disabled={busy === row.key}
            >
              {busy === row.key ? '…' : row.locked ? '🔒 LOCKED' : '🔓 OPEN'}
            </button>
          </li>
        ))}
        {rows.length === 0 && <p className="status-text" style={{ margin: 0 }}>No features registered.</p>}
      </ul>
    </div>
  );
}

// --- sprite manager --------------------------------------------------------------

/** slot → where it's referenced (themes, rosters, animations, hard-coded props). */
type UsageMap = Record<string, string[]>;

/** Build the usage map from built-in themes, custom themes, and animations. */
function collectUsage(customThemes: ThemeMeta[], anims: api.AnimDef[]): UsageMap {
  const usage: UsageMap = {};
  const add = (slot: string | undefined, where: string) => {
    if (!slot) return;
    (usage[slot] ??= []).push(where);
  };
  const addTheme = (name: string, t: { monsters?: string[]; boss?: string; spriteOverrides?: Record<string, string> }) => {
    t.monsters?.forEach((m) => add(m, `${name} · patrol`));
    add(t.boss, `${name} · boss`);
    for (const [slot, file] of Object.entries(t.spriteOverrides ?? {})) {
      add(slot, `${name} · art swap`);
      add(file, `${name} · replacement art`);
    }
  };
  for (const t of THEMES) addTheme(`${t.name} (built-in)`, t);
  for (const t of customThemes) {
    if (!t.builtin) addTheme(t.name, t);
  }
  for (const a of anims) a.frames.forEach((f, i) => add(f, `${a.name} · frame ${i + 1}`));
  add('castle_gate', 'Level props · hard-coded');
  return usage;
}

function SpritesTab() {
  const [files, setFiles] = useState<string[] | null>(null);
  const [custom, setCustom] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newSlot, setNewSlot] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usage, setUsage] = useState<UsageMap | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    api.getAdminSprites()
      .then((s) => { setFiles(s.files); setCustom(s.custom ?? []); })
      .catch(() => { setFiles([]); setCustom([]); });
    void refreshSpriteVersions(); // warm the ?v= map so previews can bust cache
    return onSpriteVersions(() => force((n) => n + 1));
  }, []);

  async function refresh() {
    try {
      const s = await api.getAdminSprites();
      setFiles(s.files);
      setCustom(s.custom ?? []);
    } catch {
      setFiles([]);
    }
  }

  async function restore(slot: string) {
    const canonical = isCanonicalSprite(slot);
    const message = canonical
      ? `Restore "${slot}" from its canonical grid? Your custom art will be replaced.`
      : `Remove the custom sprite "${slot}"? Anything using it falls back to its default art.`;
    if (!window.confirm(message)) return;
    setBusy(slot);
    try {
      const res = await api.restoreSprite(slot);
      await refreshSpriteVersions(); // drop the slot's ?v= → preview falls back to grid art
      setNotice(res.note ?? `${slot} restored from the canonical grid.`);
      await refresh();
      force((n) => n + 1);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Batch-add sprites from files (picker, drop, or paste). Names come from
   *  filenames (minus .png); a typed base name overrides the single-file case
   *  or prefixes multiple files (base_1, base_2…). DB-backed, so the art
   *  survives redeploys even where the disk is read-only. */
  async function addSprites(slotBase: string, files: File[]) {
    if (files.length === 0) return;
    const base = slotBase.trim().toLowerCase().replace(/\s+/g, '_');
    const pngs = files.filter((f) => f.type === 'image/png');
    const skippedNonPng = files.length - pngs.length;
    const tooBig = pngs.filter((f) => f.size > 512 * 1024);
    const ok = pngs.filter((f) => f.size <= 512 * 1024);
    const added: string[] = [];
    const failures: string[] = [];
    setBusy('__batch__');
    try {
      for (let i = 0; i < ok.length; i++) {
        const f = ok[i];
        let name: string;
        if (base && ok.length === 1) name = base;
        else if (base) name = `${base}_${i + 1}`;
        else {
          name = f.name.replace(/\.png$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
          if (!name) name = `pasted_${Date.now()}`;
        }
        if (!/^[a-z0-9_]{1,64}$/.test(name)) {
          failures.push(`${f.name} → invalid name "${name}"`);
          continue;
        }
        try {
          await api.uploadSprite(name, f);
          added.push(name);
        } catch (e) {
          failures.push(`${f.name} → ${(e as Error).message}`);
        }
      }
      const parts: string[] = [];
      if (added.length > 0) parts.push(`Added ${added.length} sprite${added.length === 1 ? '' : 's'}: ${added.join(', ')}.`);
      if (skippedNonPng > 0) parts.push(`${skippedNonPng} non-PNG file${skippedNonPng === 1 ? '' : 's'} skipped.`);
      if (tooBig.length > 0) parts.push(`${tooBig.length} file${tooBig.length === 1 ? '' : 's'} over 512 KB skipped.`);
      if (failures.length > 0) parts.push(`Failed — ${failures.join('; ')}.`);
      if (parts.length > 0) setNotice(parts.join(' '));
      if (added.length > 0) {
        setNewSlot('');
        await refreshSpriteVersions();
        await refresh();
        force((n) => n + 1);
      }
    } finally {
      setBusy(null);
    }
  }

  // Paste PNGs straight into the vault (Ctrl+V of a copied image).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const pasted = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type === 'image/png');
      if (pasted.length > 0) void addSprites(newSlot, pasted);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSlot]);

  /** Lazy-load the usage map the first time the panel opens. */
  async function toggleUsage() {
    const next = !usageOpen;
    setUsageOpen(next);
    if (next && usage === null) {
      try {
        const [themesRes, animsRes] = await Promise.all([
          api.getThemes(),
          api.getAnimations().catch(() => ({ animations: [], unassigned: [] })),
        ]);
        setUsage(collectUsage(themesRes.themes ?? [], animsRes.animations));
      } catch {
        setUsage({});
      }
    }
  }

  const shown = (files ?? []).filter((f) => f.includes(filter.toLowerCase()));

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>🎨 SPRITE VAULT</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Click a sprite to upload a replacement PNG (exact size matters — see docs/ASSET_GUIDE.md).
        Restore re-renders the original from code.
      </p>
      <input className="pixel-input" placeholder="Filter slots…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: '0.75rem', width: '100%' }} />
      {notice && <p className="status-text">{notice}</p>}
      {files === null ? (
        <p className="status-text">Opening the vault…</p>
      ) : files.length === 0 ? (
        <p className="status-text" style={{ margin: '0 0 0.75rem' }}>
          The vault is empty — the server has no static sprite pack and no custom uploads yet.
          Add the first sprite below. Built-in slots (goblin, boss, props, avatars…) come from the
          code build and keep working in-game regardless.
        </p>
      ) : null}
      {/* Batch-add: pick files, drag & drop onto the zone, or paste copied PNGs.
          Names come from filenames; a typed base name names a single upload or
          prefixes many (frost_golem_1, frost_golem_2…). */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files ?? []);
          if (dropped.length > 0) void addSprites(newSlot, dropped);
        }}
        style={{
          display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center',
          margin: '0.25rem 0 0.75rem', padding: '0.5rem',
          border: `2px dashed ${dragOver ? 'var(--p-yellow)' : 'rgba(255,255,255,0.2)'}`,
          background: dragOver ? 'rgba(255,200,60,0.08)' : 'transparent',
        }}
      >
        <input
          className="pixel-input"
          placeholder="base name (optional — filenames name the rest)"
          value={newSlot}
          onChange={(e) => setNewSlot(e.target.value)}
          style={{ flex: '1 1 220px', maxWidth: 300 }}
        />
        <label
          className={`pixel-btn ${newSlot.trim() || dragOver ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
          style={{ fontSize: '0.6rem', cursor: busy ? 'wait' : 'pointer' }}
          title="Upload PNGs into new sprite slots — names come from filenames"
        >
          {busy === '__batch__' ? '…' : '＋ ADD SPRITES'}
          <input
            type="file"
            accept="image/png"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length > 0) void addSprites(newSlot, picked);
              e.target.value = '';
            }}
          />
        </label>
        <span className="term-font" style={{ fontSize: '0.85rem', color: 'var(--d-stone-light)' }}>
          …or drop PNGs here / paste (Ctrl+V). Names from filenames{newSlot.trim() ? `; "${newSlot.trim()}" names one or prefixes the rest` : ''}.
        </span>
      </div>
      {/* Usage map — where each slot is referenced, so admins see impact before replacing art. */}
      <button
        className="pixel-btn pixel-btn--ghost"
        style={{ fontSize: '0.6rem', marginBottom: '0.5rem' }}
        aria-expanded={usageOpen}
        onClick={() => void toggleUsage()}
      >
        {usageOpen ? '▾' : '▸'} WHERE SPRITES ARE USED
      </button>
      {usageOpen && (
        usage === null ? (
          <p className="status-text">Mapping sprite usage…</p>
        ) : (
          <div style={{ marginBottom: '0.75rem', maxHeight: 220, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.12)', padding: '0.5rem' }}>
            {Object.keys(usage).length === 0 ? (
              <p className="status-text" style={{ margin: 0 }}>No references found — every theme uses its default roster.</p>
            ) : (
              Object.entries(usage).sort(([a], [b]) => a.localeCompare(b)).map(([slot, where]) => (
                <p key={slot} className="term-font" style={{ fontSize: '0.9rem', margin: '0.15rem 0' }}>
                  <strong style={{ color: 'var(--p-yellow)' }}>{slot}</strong>
                  <span style={{ color: 'var(--d-stone-light)' }}> — {where.join(' · ')}</span>
                </p>
              ))
            )}
          </div>
        )
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem' }}>
        {shown.map((slot) => (
          <SpriteCell key={slot} slot={slot} busy={busy === slot} custom={custom.includes(slot)} usage={usageOpen ? usage?.[slot] : undefined} onRestore={() => void restore(slot)} onUpload={async (file) => {
            setBusy(slot);
            try {
              await api.uploadSprite(slot, file);
              await refreshSpriteVersions(); // new ?v= for this slot → cache busted everywhere
              setNotice(`${slot} updated — players get it on their next sprite load.`);
              setCustom((c) => (c.includes(slot) ? c : [...c, slot]));
              force((n) => n + 1);
            } catch (e) {
              setNotice((e as Error).message);
            } finally {
              setBusy(null);
            }
          }} />
        ))}
      </div>
    </div>
  );
}

function SpriteCell({ slot, busy, custom, usage, onRestore, onUpload }: { slot: string; busy: boolean; custom: boolean; usage?: string[]; onRestore: () => void; onUpload: (f: File) => void }) {
  const isCanonical = isCanonicalSprite(slot);
  const [failed, setFailed] = useState(false);
  const used = usage && usage.length > 0;
  return (
    <div style={{ textAlign: 'center', border: `1px solid ${used ? 'rgba(230,180,60,0.55)' : 'rgba(255,255,255,0.15)'}`, padding: '0.4rem', position: 'relative' }}>
      {used && (
        <span
          title={`In use — ${usage!.join(', ')}`}
          aria-label={`Used by ${usage!.length} reference${usage!.length === 1 ? '' : 's'}`}
          style={{ position: 'absolute', top: 2, right: 4, fontSize: '0.55rem' }}
        >
          🔗{usage!.length > 1 ? usage!.length : ''}
        </span>
      )}
      <img
        src={custom ? spriteApiUrl(slot) : spriteDataUrl(slot)}
        alt={slot}
        title={custom ? 'Custom art (stored server-side)' : isCanonical ? 'Built-in grid art' : 'Custom PNG (served from disk)'}
        style={{ width: 48, height: 48, imageRendering: 'pixelated', objectFit: 'contain' }}
        onError={() => setFailed(true)}
      />
      <p className="term-font" style={{ fontSize: '0.7rem', margin: '0.25rem 0', wordBreak: 'break-all' }}>{failed && !custom ? '⚠ ' : ''}{slot}</p>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
        <label className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? '…' : '⬆'}
          <input
            type="file"
            accept="image/png"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
        {custom ? (
          <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem', color: 'var(--p-red)' }} onClick={onRestore} disabled={busy} title="Remove this custom sprite">🗑</button>
        ) : isCanonical ? (
          <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} onClick={onRestore} disabled={busy} title="Restore from canonical grid">↺</button>
        ) : null}
      </div>
    </div>
  );
}

// --- sprite animations ----------------------------------------------------------------

/**
 * Infers a likely animation name from a frame slot name: strips the trailing
 * frame number — dragon_flap3 → dragon_flap, dragon_idle → dragon_idle.
 */
function guessAnimName(slot: string): string {
  return slot.replace(/\d+$/, '');
}

function AnimationsTab() {
  const [animations, setAnimations] = useState<AnimDef[]>([]);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [fps, setFps] = useState(8);
  const [loop, setLoop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);

  const refresh = useCallback(() => {
    api.getAnimations().then((r) => {
      setAnimations(r.animations);
      setUnassigned(r.unassigned);
    }).catch((e) => setNotice((e as Error).message));
  }, []);
  useEffect(refresh, [refresh]);

  function togglePick(slot: string) {
    setSelected((s) => (s.includes(slot) ? s.filter((x) => x !== slot) : [...s, slot]));
  }

  /** Auto-pick one trailing-number group (e.g. all dragon_flap* frames). */
  function autoPick(base: string) {
    const group = unassigned.filter((f) => guessAnimName(f) === base).sort();
    setSelected(group);
    setName(base);
  }

  async function create() {
    setNotice(null);
    if (!name.trim() || selected.length === 0) {
      setNotice('Pick a name and at least one frame.');
      return;
    }
    setBusy(true);
    try {
      await api.saveAnimation(name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'), { frames: selected, fps, loop });
      setNotice(`Animation "${name}" registered — monsters with that sprite slot will play it.`);
      setSelected([]);
      setName('');
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(n: string) {
    if (!window.confirm(`Delete animation "${n}"? Monsters fall back to its static sprite.`)) return;
    try {
      await api.deleteAnimation(n);
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  // Preview player: cycles the selected frames at the chosen fps.
  useEffect(() => {
    if (selected.length === 0) return;
    const t = window.setInterval(() => setPreviewIdx((i) => (i + 1) % selected.length), Math.round(1000 / Math.max(fps, 1)));
    return () => window.clearInterval(t);
  }, [selected, fps]);

  const bases = [...new Set(unassigned.map(guessAnimName))];

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>🎞 ANIMATION STUDIO</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Upload frames in the Sprites tab (names like <code>dragon_flap1</code>, <code>dragon_flap2</code>,
        <code> dragon_idle</code>), then group them here into a playable clip. A clip plays on any
        monster whose sprite slot matches the clip name (or whose slot name starts with it).
      </p>
      {notice && <p className="status-text">{notice}</p>}

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0 0 0.4rem' }}>REGISTERED CLIPS</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
        {animations.map((a) => (
          <li key={a.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="term-font" style={{ fontSize: '0.95rem' }}>
              <strong>{a.name}</strong> · {a.frames.length} frame{a.frames.length === 1 ? '' : 's'} · {a.fps} fps · {a.loop ? 'loops' : 'once'}
              <span style={{ color: 'var(--d-stone-light)' }}> ({a.frames.join(', ')})</span>
            </span>
            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.55rem' }} onClick={() => void remove(a.name)}>✕</button>
          </li>
        ))}
        {animations.length === 0 && <p className="status-text" style={{ margin: 0 }}>None yet — group some frames below.</p>}
      </ul>

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0 0 0.4rem' }}>NEW CLIP</p>
      {bases.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <span className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)' }}>Quick-pick group:</span>
          {bases.map((b) => (
            <button key={b} className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.55rem' }} onClick={() => autoPick(b)}>
              {b} ({unassigned.filter((f) => guessAnimName(f) === b).length})
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <input className="pixel-input" placeholder="clip name (e.g. dragon_flap)" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
        <label className="term-font" style={{ fontSize: '0.9rem' }}>fps</label>
        <input className="pixel-input" type="number" min={1} max={30} value={fps} onChange={(e) => setFps(Number(e.target.value))} style={{ width: 70 }} />
        <label className="term-font" style={{ fontSize: '0.9rem' }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> loop
        </label>
      </div>
      {unassigned.length === 0 ? (
        <p className="status-text" style={{ margin: 0 }}>No spare frames — upload PNGs in the Sprites tab first.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.4rem' }}>
          {unassigned.map((slot) => {
            const isSel = selected.includes(slot);
            return (
              <button
                key={slot}
                onClick={() => togglePick(slot)}
                title={slot}
                style={{
                  textAlign: 'center', padding: '0.3rem', cursor: 'pointer',
                  border: isSel ? '2px solid var(--d-gold)' : '1px solid rgba(255,255,255,0.15)',
                  background: 'transparent', color: 'var(--d-parchment)',
                }}
              >
                <img src={`/sprites/${slot}.png`} alt={slot} style={{ width: 40, height: 40, imageRendering: 'pixelated', objectFit: 'contain' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                <p className="term-font" style={{ fontSize: '0.65rem', margin: '0.15rem 0 0', wordBreak: 'break-all' }}>{slot}</p>
              </button>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 64, height: 64, display: 'grid', placeItems: 'center', background: 'var(--d-black)', border: '2px solid var(--d-darkwood)' }}>
            <img key={previewIdx} src={`/sprites/${selected[previewIdx]}.png`} alt="preview" style={{ width: 56, height: 56, imageRendering: 'pixelated', objectFit: 'contain' }}
              onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
          </div>
          <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.65rem' }} onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? '…' : `REGISTER CLIP (${selected.length} frames)`}
          </button>
        </div>
      )}
    </div>
  );
}

// --- custom map themes ------------------------------------------------------------------

const THEME_COLOR_FIELDS: { key: keyof CustomThemePayload; label: string; hint: string }[] = [
  { key: 'sky', label: 'Sky', hint: 'Backdrop sky fill' },
  { key: 'stars', label: 'Stars', hint: 'Star/firefly dots' },
  { key: 'farHills', label: 'Far hills', hint: 'Distant silhouette layer' },
  { key: 'nearHills', label: 'Near hills', hint: 'Near parallax layer' },
  { key: 'pit', label: 'Pit', hint: 'Pit darkness' },
  { key: 'floorTop', label: 'Floor lip', hint: '4px walkable floor top' },
  { key: 'floorBody', label: 'Floor body', hint: 'Floor under the lip' },
  { key: 'floorSpeckle', label: 'Speckles', hint: 'Floor texture dots' },
  { key: 'hpFilled', label: 'HP filled', hint: 'Monster HP pip color' },
  { key: 'hpEmpty', label: 'HP empty', hint: 'Lost HP pip color' },
];

const THEME_PRESETS: Record<string, Partial<CustomThemePayload>> = {
  ember: { sky: '#2a0f0a', stars: '#ffb347', farHills: '#571c12', nearHills: '#3a1410', pit: '#000000', floorTop: '#8a4a2b', floorBody: '#40201a', floorSpeckle: '#5c2f24', hpFilled: '#a82a2a', hpEmpty: '#5c2f24', particleHit: '#ff7b39' },
  frost: { sky: '#14202e', stars: '#d7ecff', farHills: '#2a4157', nearHills: '#3a5a73', pit: '#040a12', floorTop: '#7f93a8', floorBody: '#43525f', floorSpeckle: '#5a6b7a', hpFilled: '#a82a2a', hpEmpty: '#43525f', dustColor: 'rgba(210, 230, 250, 0.7)' },
};

/**
 * Module-level cache of every sprite slot on the server (canonical + custom
 * uploads). Filled lazily by the Theme Forge's slot picker; the cache lets
 * re-opens render instantly without re-fetching.
 */
let spriteListCache: string[] = [];

function ThemesTab({ themes }: { themes: ThemeMeta[] }) {
  const [id, setId] = useState('');
  const [form, setForm] = useState<Partial<CustomThemePayload>>({ name: '', ...THEME_PRESETS.ember });
  const [monsters, setMonsters] = useState('');
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [pickOpen, setPickOpen] = useState(false);
  const [allSlots, setAllSlots] = useState<string[] | null>(spriteListCache.length > 0 ? spriteListCache : null);
  const [pickFilter, setPickFilter] = useState('');
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [overridePngs, setOverridePngs] = useState<Record<string, File>>({});

  // Every slot on the server (canonical grids + custom uploads) — the picker
  // browses all of them. Falls back to the in-code grid names when the admin
  // API is unreachable.
  useEffect(() => {
    api.getAdminSprites()
      .then((s) => { spriteListCache = s.files; setAllSlots(s.files); })
      .catch(() => setAllSlots((cur) => cur ?? SPRITES.map((s) => s.name)));
  }, []);

  // Grid slots render from the in-code raster (works even if the PNG is
  // missing); custom uploads render straight from their PNG file.
  const gridSlots = useMemo(() => new Set([...SPRITES, ...AVATAR_GRIDS].map((s) => s.name)), []);
  const slotSrc = (s: string) => (gridSlots.has(s) ? spriteDataUrl(s) : `/sprites/${s}.png`);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (patch: Partial<CustomThemePayload>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setNotice(null);
    if (!id.trim() || !form.name?.trim()) {
      setNotice('Theme id and display name are required.');
      return;
    }
    // Wait for any staged PNG uploads first — swaps reference their filenames.
    if (Object.keys(overridePngs).length > 0) {
      try {
        const res = await api.uploadSpriteFrames(Object.keys(overridePngs), Object.values(overridePngs));
        setNotice(`Uploaded ${res.uploaded.length} custom sprite${res.uploaded.length === 1 ? '' : 's'} — `);
      } catch (e) {
        setNotice(`Sprite upload failed: ${(e as Error).message}`);
        return;
      }
    }
    setBusy(true);
    try {
      const payload: CustomThemePayload = {
        ...(THEME_PRESETS.ember as CustomThemePayload),
        ...form,
        monsters: monsters.split(',').map((s) => s.trim()).filter(Boolean),
        spriteOverrides: Object.keys(swaps).length > 0 ? swaps : undefined,
      } as CustomThemePayload;
      await api.saveCustomTheme(id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_'), payload);
      setNotice(`Theme "${form.name}" saved — it is live in the theme picker and quest rotation.`);
      setOverridePngs({});
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(themeId: string) {
    if (!window.confirm(`Delete theme "${themeId}"? Quests using it fall back to the dungeon look.`)) return;
    try {
      await api.deleteCustomTheme(themeId);
      setNotice(`Theme "${themeId}" deleted.`);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  const custom = themes.filter((t) => !t.builtin);

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>🗺 THEME FORGE</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Create new map looks (colors + which monsters patrol). Saved themes join the quest rotation,
        the Map tab's fixed-theme picker, and teachers' guild skins — no redeploy needed.
      </p>
      {notice && <p className="status-text">{notice}</p>}

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0 0 0.4rem' }}>CUSTOM THEMES</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
        {custom.map((t) => (
          <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="term-font" style={{ fontSize: '0.95rem' }}><strong>{t.name}</strong> · {t.id}</span>
            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.55rem' }} onClick={() => void remove(t.id)}>✕</button>
          </li>
        ))}
        {custom.length === 0 && <p className="status-text" style={{ margin: 0 }}>Only built-ins (dungeon, forest) so far.</p>}
      </ul>

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0 0 0.4rem' }}>➕ CREATE / UPDATE</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <input className="pixel-input" placeholder="id (e.g. volcano)" value={id} onChange={(e) => setId(e.target.value)} style={{ width: 140 }} />
        <input className="pixel-input" placeholder="Display name" value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} style={{ width: 170 }} />
        <span className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)' }}>Preset:</span>
        {Object.keys(THEME_PRESETS).map((p) => (
          <button key={p} className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.55rem' }} onClick={() => set({ ...THEME_PRESETS[p] })}>{p}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {THEME_COLOR_FIELDS.map(({ key, label, hint }) => (
          <label key={String(key)} className="term-font" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }} title={hint}>
            <input
              type="color"
              value={toHex(form[key] as string | undefined)}
              onChange={(e) => set({ [key]: e.target.value } as Partial<CustomThemePayload>)}
              style={{ width: 28, height: 24, padding: 0, border: '2px solid var(--d-darkwood)', background: 'none', cursor: 'pointer' }}
            />
            {label}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        <input className="pixel-input" placeholder="patrol monsters (comma-separated sprite slots, e.g. enemy_bat, dragon_flap)" value={monsters} onChange={(e) => setMonsters(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
      </div>

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0.6rem 0 0.3rem' }}>🧩 SPRITE SWAPS (optional — replace any sprite slot just for this map)</p>
      {Object.keys(swaps).length === 0 && (
        <p className="status-text" style={{ margin: '0 0 0.4rem' }}>No swaps — this map uses the standard sprites.</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
        {Object.entries(swaps).map(([slot, file]) => (
          <div key={slot} style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '0.4rem', textAlign: 'center' }}>
            <p className="term-font" style={{ fontSize: '0.6rem', margin: '0 0 0.25rem' }}>
              {slot} → <strong style={{ color: 'var(--d-gold)' }}>{file}</strong>
            </p>
            <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center', alignItems: 'flex-end' }}>
              <img src={slotSrc(slot)} alt={slot} title="current art"
                style={{ width: 36, height: 36, imageRendering: 'pixelated', objectFit: 'contain', background: 'var(--d-black)' }}
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
              <span className="term-font" style={{ fontSize: '0.8rem' }}>→</span>
              <img src={overridePngs[file] ? URL.createObjectURL(overridePngs[file]) : `/sprites/${file}.png`} alt={file} title="replacement art"
                style={{ width: 36, height: 36, imageRendering: 'pixelated', objectFit: 'contain', background: 'var(--d-black)' }}
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: '0.3rem' }}>
              <label className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem', cursor: 'pointer' }} title="Upload replacement PNG">
                {overridePngs[file] ? '⬆✓' : '⬆'}
                <input type="file" accept="image/png" style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setOverridePngs((m) => ({ ...m, [file]: f }));
                    e.target.value = '';
                  }} />
              </label>
              <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} title="Change replacement slot"
                onClick={() => { setPickFor(slot); setPickOpen(true); }}>⚙</button>
              <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} title="Remove swap"
                onClick={() => setSwaps((m) => { const n = { ...m }; delete n[slot]; return n; })}>✕</button>
            </div>
          </div>
        ))}
        <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem', alignSelf: 'center', minHeight: 64 }}
          onClick={() => { setPickFor(null); setPickOpen(true); }}>
          + ADD SWAP
        </button>
      </div>

      {pickOpen && (
        <div style={{ border: '2px solid var(--d-darkwood)', padding: '0.6rem', marginBottom: '0.6rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <p className="pixel-font" style={{ fontSize: '0.6rem', margin: 0, flex: 1 }}>
              {pickFor ? `REPLACEMENT FOR: ${pickFor}` : 'WHICH SPRITE SLOT SHOULD THIS MAP REPLACE?'}
            </p>
            <input className="pixel-input" placeholder="Filter slots…" value={pickFilter} onChange={(e) => setPickFilter(e.target.value)} style={{ width: 150 }} />
            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} onClick={() => setPickOpen(false)}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: '0.3rem', maxHeight: 220, overflowY: 'auto' }}>
            {(allSlots ?? []).filter((s) => s.includes(pickFilter.toLowerCase())).map((s) => {
              const isTarget = !pickFor && !!swaps[s];
              const isReplacement = pickFor !== null && swaps[pickFor] === s;
              return (
                <button
                  key={s}
                  title={isTarget ? 'Already being replaced on this map' : isReplacement ? 'Current replacement for ' + pickFor : s}
                  style={{
                    textAlign: 'center', padding: '0.25rem', cursor: 'pointer',
                    border: isReplacement ? '2px solid var(--d-gold)' : isTarget ? '2px solid var(--p-red)' : '1px solid rgba(255,255,255,0.15)',
                    background: 'transparent', color: 'var(--d-parchment)',
                  }}
                  onClick={() => {
                    if (pickFor === null) {
                      setSwaps((m) => (m[s] ? m : { ...m, [s]: s })); // start same→same
                      setPickFor(s);
                    } else {
                      setSwaps((m) => ({ ...m, [pickFor]: s }));
                      setPickOpen(false);
                      setPickFor(null);
                    }
                  }}
                >
                  <img src={slotSrc(s)} alt={s} style={{ width: 32, height: 32, imageRendering: 'pixelated', objectFit: 'contain' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                  <p className="term-font" style={{ fontSize: '0.55rem', margin: '0.1rem 0 0', wordBreak: 'break-all' }}>{s}</p>
                </button>
              );
            })}
          </div>
          <p className="term-font" style={{ fontSize: '0.75rem', color: 'var(--d-stone-light)', margin: '0.4rem 0 0' }}>
            Red-bordered slots are already replaced on this map (click one to change its replacement). Gold border marks the current replacement.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.65rem' }} onClick={() => void save()} disabled={busy || !id.trim() || !form.name?.trim()}>
          {busy ? '…' : 'SAVE THEME'}
        </button>
      </div>
      <p className="term-font" style={{ fontSize: '0.85rem', color: 'var(--d-stone-light)', margin: '0.5rem 0 0' }}>
        Tip: reference animation clips from the Animations tab as patrol monsters — e.g.
        <code> dragon_flap</code>. Test any theme live with <code>?theme=&lt;id&gt;</code> in the URL.
      </p>
    </div>
  );
}

/** Best-effort hex conversion for <input type="color"> (defaults to black). */
function toHex(v: string | undefined): string {
  if (v && /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (v && /^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return '#000000';
}

// --- map config --------------------------------------------------------------------

function MapTab({ themes }: { themes: ThemeMeta[] }) {
  const [cfg, setCfg] = useState<MapConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { api.getAdminMap().then(setCfg).catch(() => setCfg(null)); }, []);

  async function save(next: MapConfig) {
    setCfg(next);
    try {
      const saved = await api.setAdminMap(next);
      setCfg(saved);
      setNotice('Map config saved — applies to every guild without its own skin.');
      window.setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  if (!cfg) return <div className="pixel-panel"><p className="status-text" style={{ margin: 0 }}>Loading map config…</p></div>;

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>🗺 GLOBAL MAP CONFIG</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Default look for realms. Teachers can override it per guild; &ldquo;random by
        difficulty&rdquo; picks deterministically so revisits match.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <button
          className={`pixel-btn ${cfg.mode === 'random_by_difficulty' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
          style={{ fontSize: '0.6rem' }}
          onClick={() => void save({ ...cfg, mode: 'random_by_difficulty' })}
        >
          🎲 RANDOM BY DIFFICULTY
        </button>
        <button
          className={`pixel-btn ${cfg.mode === 'fixed' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
          style={{ fontSize: '0.6rem' }}
          onClick={() => void save({ ...cfg, mode: 'fixed' })}
        >
          📌 FIXED THEME
        </button>
      </div>
      {cfg.mode === 'fixed' && (
        <div>
          <select
            className="pixel-select"
            value={cfg.fixedTheme}
            onChange={(e) => void save({ ...cfg, fixedTheme: e.target.value })}
          >
            {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      {notice && <p className="status-text" style={{ marginBottom: 0 }}>{notice}</p>}
    </div>
  );
}

// --- shop management -------------------------------------------------------------------

const EMPTY_FORM = { sku: '', name: '', description: '', category: 'hair' as ShopItem['category'], kind: '', price: 10, sort: 1 };

function ShopTab() {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getShop().then((s) => setItems(s.items)).catch(() => setItems([]));
  }, []);
  useEffect(refresh, [refresh]);

  async function create() {
    setNotice(null);
    try {
      await api.createShopItem({ ...form, kind: form.kind || `${form.category}:${form.sku}` });
      setForm({ ...EMPTY_FORM });
      setNotice('Item added to the shop.');
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this item from the shop? Players who bought it keep it.')) return;
    try {
      await api.deleteShopItem(id);
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.5rem' }}>🪙 SHOP STOCK</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
        {items.map((i) => (
          <li key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="term-font" style={{ fontSize: '0.95rem' }}>
              {i.name} <span style={{ color: 'var(--d-stone-light)' }}>· {i.category} · {i.price} 🪙 · {i.sku}</span>
            </span>
            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.55rem' }} onClick={() => void remove(i.id)}>✕</button>
          </li>
        ))}
        {items.length === 0 && <p className="status-text" style={{ margin: 0 }}>Empty — add the first item below.</p>}
      </ul>

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0 0 0.4rem' }}>➕ ADD ITEM</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        <input className="pixel-input" placeholder="sku (e.g. cape_red)" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} style={{ width: 140 }} />
        <input className="pixel-input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 160 }} />
        <select className="pixel-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ShopItem['category'] })}>
          {['hair', 'armor', 'helmet', 'pack'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="pixel-input" type="number" min={0} placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} style={{ width: 80 }} />
        <input className="pixel-input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
        <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.6rem' }} onClick={() => void create()} disabled={!form.sku || !form.name}>
          ADD
        </button>
      </div>
      {notice && <p className="status-text" style={{ marginBottom: 0 }}>{notice}</p>}
    </div>
  );
}

// --- guild management ---------------------------------------------------------------------

function GuildsTab() {
  const [guilds, setGuilds] = useState<GuildAdminInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [view, setView] = useState<'members' | 'settings'>('members');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshGuilds = useCallback(async () => {
    try {
      const res = await api.getAdminGuilds();
      setGuilds(res.guilds);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void refreshGuilds(); }, [refreshGuilds]);

  const loadRoster = useCallback(async (guildId: string) => {
    try {
      const res = await api.getAdminGuildMembers(guildId);
      setRoster(res.roster);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (selected) {
      setView('members');
      void loadRoster(selected);
    }
  }, [selected, loadRoster]);

  async function regenerateCode(guildId: string) {
    if (!window.confirm('Regenerate this guild\'s join code? The old one stops working immediately.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.regenerateAdminGuildPasscode(guildId);
      setNotice(`New code: ${res.passcode}`);
      await refreshGuilds();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function kick(guildId: string, m: RosterEntry) {
    if (!window.confirm(`Dismiss ${m.name} from the guild? Their progress is kept — they can rejoin with the code.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeAdminGuildMember(guildId, m.id);
      setNotice(`${m.name} has left the guild.`);
      await Promise.all([loadRoster(guildId), refreshGuilds()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = guilds.find((g) => g.id === selected) ?? null;

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>🏰 GUILD DIRECTORY</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Manage any guild's join code, members, and term settings — the same powers its guild master has.
      </p>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="status-text">{notice}</p>}

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
        {guilds.map((g) => (
          <li
            key={g.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
              padding: '0.5rem 0.4rem', borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: selected === g.id ? 'rgba(232,180,60,0.12)' : undefined,
              outline: selected === g.id ? '2px solid var(--d-gold)' : undefined,
            }}
          >
            <button
              className="pixel-btn pixel-btn--ghost"
              style={{ fontSize: '0.6rem', textAlign: 'left', flex: 1, minWidth: 180 }}
              onClick={() => setSelected(g.id)}
            >
              🏰 {g.name} — {g.teacherName} · {g.memberCount} member{g.memberCount === 1 ? '' : 's'} · code {g.passcode}
            </button>
            <button
              className="pixel-btn pixel-btn--ghost"
              style={{ fontSize: '0.55rem', whiteSpace: 'nowrap' }}
              onClick={() => void regenerateCode(g.id)}
              disabled={busy}
            >
              ♻ NEW CODE
            </button>
          </li>
        ))}
        {guilds.length === 0 && <p className="status-text" style={{ margin: 0 }}>No guilds founded yet.</p>}
      </ul>

      {current && (
        <div style={{ borderTop: '2px dashed rgba(232,180,60,0.4)', paddingTop: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <span className="pixel-font" style={{ fontSize: '0.7rem', color: 'var(--d-gold)', alignSelf: 'center' }}>
              {current.name.toUpperCase()}
            </span>
            <button
              className={`pixel-btn ${view === 'members' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
              style={{ fontSize: '0.6rem' }}
              onClick={() => setView('members')}
            >
              👥 MEMBERS ({roster.length})
            </button>
            <button
              className={`pixel-btn ${view === 'settings' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
              style={{ fontSize: '0.6rem' }}
              onClick={() => setView('settings')}
            >
              ⚙ SETTINGS
            </button>
          </div>

          {view === 'members' && (
            <>
              {roster.length === 0 && <p className="status-text" style={{ margin: 0 }}>No students in this guild.</p>}
              {roster.map((m) => (
                <div key={m.id} className="leaderboard-row">
                  <AvatarSprite avatar={m.avatar ?? DEFAULT_AVATAR} size={24} title={`${m.name}'s heraldic avatar`} />
                  <span className="term-font" style={{ fontSize: '1.1rem', flex: 1 }}>{m.name}</span>
                  <span className="pixel-font" style={{ fontSize: '0.65rem', color: 'var(--d-gold)' }}>{m.score}</span>
                  <button
                    className="pixel-btn pixel-btn--ghost"
                    style={{ fontSize: '0.55rem', padding: '0.25rem 0.5rem' }}
                    onClick={() => void kick(current.id, m)}
                    disabled={busy}
                  >
                    ✖ DISMISS
                  </button>
                </div>
              ))}
            </>
          )}

          {view === 'settings' && (
            <GuildSettings guildId={current.id} onSaved={() => setNotice(`${current.name} settings saved.`)} />
          )}
        </div>
      )}
    </div>
  );
}

// --- admin account management ------------------------------------------------------------

const ADMIN_ACTIONS_HELP = 'Admins hold every teacher power, manage all guilds, and alone reach this panel.';

function AdminsTab() {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [grantEmail, setGrantEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getAdminAccounts().then((r) => setAdmins(r.admins)).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(refresh, [refresh]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canCreate = form.name.trim() && form.email.trim() && form.password.length >= 8;

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>👑 ROYAL CROWN</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        {ADMIN_ACTIONS_HELP} Every grant, creation, and demotion lands in the audit log.
      </p>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="status-text">{notice}</p>}

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
        {admins.map((a) => (
          <li key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="term-font" style={{ fontSize: '0.95rem' }}>
              <strong>{a.name}</strong> <span style={{ color: 'var(--d-stone-light)' }}>· {a.email}</span>
            </span>
            <button
              className="pixel-btn pixel-btn--ghost"
              style={{ fontSize: '0.55rem', whiteSpace: 'nowrap' }}
              disabled={busy || admins.length <= 1}
              title={admins.length <= 1 ? 'The last admin cannot be demoted' : 'Demote to student'}
              onClick={() => {
                if (window.confirm(`Demote ${a.name} to a student? They lose admin powers immediately.`)) {
                  void run(async () => {
                    await api.demoteAdminAccount(a.id);
                    setNotice(`${a.name} is no longer an admin.`);
                    refresh();
                  });
                }
              }}
            >
              ✕ DEMOTE
            </button>
          </li>
        ))}
        {admins.length === 0 && <p className="status-text" style={{ margin: 0 }}>Loading admins…</p>}
      </ul>

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0 0 0.4rem' }}>➕ CREATE NEW ADMIN</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginBottom: '0.9rem' }}>
        <input className="pixel-input" placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 140 }} />
        <input className="pixel-input" type="email" placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ width: 200 }} />
        <input className="pixel-input" type="password" placeholder="password (8+ chars)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ width: 170 }} />
        <button
          className="pixel-btn pixel-btn--gold"
          style={{ fontSize: '0.6rem' }}
          disabled={busy || !canCreate}
          onClick={() => void run(async () => {
            const r = await api.createAdminAccount(form.name.trim(), form.email.trim(), form.password);
            setNotice(`Admin account created for ${r.admin.email}.`);
            setForm({ name: '', email: '', password: '' });
            refresh();
          })}
        >
          {busy ? '…' : 'CREATE'}
        </button>
      </div>

      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: '0 0 0.4rem' }}>⬆ PROMOTE EXISTING USER</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        <input
          className="pixel-input"
          type="email"
          placeholder="email of a teacher or student"
          value={grantEmail}
          onChange={(e) => setGrantEmail(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <button
          className="pixel-btn pixel-btn--gold"
          style={{ fontSize: '0.6rem' }}
          disabled={busy || !grantEmail.trim()}
          onClick={() => void run(async () => {
            const r = await api.grantAdminAccount(grantEmail.trim());
            setNotice(`${r.admin.name} (${r.admin.email}) is now an admin.`);
            setGrantEmail('');
            refresh();
          })}
        >
          {busy ? '…' : 'GRANT CROWN'}
        </button>
      </div>
    </div>
  );
}

// --- audit log ------------------------------------------------------------------------------

const ACTION_LABEL: Record<string, string> = {
  sprite_upload: 'uploaded sprite',
  sprite_restore: 'restored sprite',
  animation_save: 'saved animation',
  animation_delete: 'deleted animation',
  theme_save: 'saved theme',
  theme_delete: 'deleted theme',
  map_config_save: 'updated global map config',
  shop_item_create: 'created shop item',
  shop_item_delete: 'deleted shop item',
  feature_lock: 'set feature lock',
  admin_created: 'created admin account',
  admin_granted: 'promoted to admin',
  admin_revoked: 'demoted admin',
};

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getAuditLog(150).then((r) => setEntries(r.entries)).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>📜 ROYAL AUDIT LOG</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Who uploaded which sprite, edited which theme, created which shop item — every admin action,
        newest first.
      </p>
      {error && <p className="error-text">{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {entries.map((e) => {
          const extra = Object.keys(e.detail ?? {});
          const detail = extra.length > 0
            ? ` (${extra.map((k) => `${k}: ${String(e.detail[k]).slice(0, 40)}`).join(', ')})`
            : '';
          return (
            <li key={e.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="term-font" style={{ fontSize: '0.95rem' }}>
                <strong>{e.actorName}</strong> {ACTION_LABEL[e.action] ?? e.action}
                {e.target && <strong> “{e.target}”</strong>}
                <span style={{ color: 'var(--d-stone-light)' }}>{detail} · {new Date(e.createdAt).toLocaleString()}</span>
              </span>
            </li>
          );
        })}
        {entries.length === 0 && !error && (
          <p className="status-text" style={{ margin: 0 }}>Nothing recorded yet — the chronicle begins with the next change.</p>
        )}
      </ul>
    </div>
  );
}

// --- the panel ---------------------------------------------------------------------------

export default function AdminPanel({ onExit }: { onExit?: () => void }) {
  const [tab, setTab] = useState<Tab>('features');
  const [themes, setThemes] = useState<ThemeMeta[]>([]);
  useEffect(() => { api.getThemes().then((r) => setThemes(r.themes)).catch(() => setThemes([])); }, []);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="pixel-panel" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <p className="pixel-font" style={{ fontSize: '0.85rem', margin: '0.25rem 0.5rem 0 0', color: 'var(--d-gold)' }}>👑 ADMIN</p>
        {(['features', 'guilds', 'admins', 'audit', 'sprites', 'animations', 'themes', 'map', 'shop'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`pixel-btn ${tab === t ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
            style={{ fontSize: '0.6rem', textTransform: 'uppercase' }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        {onExit && (
          <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem', marginLeft: 'auto' }} onClick={onExit}>
            ◀ HALL
          </button>
        )}
      </div>
      {tab === 'features' && <FeaturesTab />}
      {tab === 'guilds' && <GuildsTab />}
      {tab === 'admins' && <AdminsTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'sprites' && <SpritesTab />}
      {tab === 'animations' && <AnimationsTab />}
      {tab === 'themes' && <ThemesTab themes={themes} />}
      {tab === 'map' && <MapTab themes={themes} />}
      {tab === 'shop' && <ShopTab />}
    </div>
  );
}
