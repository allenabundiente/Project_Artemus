import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { FeatureRow, MapConfig, ShopItem, ThemeMeta } from '../types';
import { spriteDataUrl } from '../game/sprites';

type Tab = 'features' | 'sprites' | 'map' | 'shop';

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

function SpritesTab() {
  const [files, setFiles] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    api.getAdminSprites().then((s) => setFiles(s.files)).catch(() => setFiles([]));
  }, []);

  async function restore(slot: string) {
    if (!window.confirm(`Restore "${slot}" from its canonical grid? Your custom art will be replaced.`)) return;
    setBusy(slot);
    try {
      await api.restoreSprite(slot);
      setNotice(`${slot} restored from the canonical grid.`);
      force((n) => n + 1);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const shown = files.filter((f) => f.includes(filter.toLowerCase()));

  return (
    <div className="pixel-panel">
      <p className="pixel-font" style={{ fontSize: '0.75rem', margin: '0 0 0.25rem' }}>🎨 SPRITE VAULT</p>
      <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0 0 0.75rem' }}>
        Click a sprite to upload a replacement PNG (exact size matters — see docs/ASSET_GUIDE.md).
        Restore re-renders the original from code.
      </p>
      <input className="pixel-input" placeholder="Filter slots…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: '0.75rem', width: '100%' }} />
      {notice && <p className="status-text">{notice}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem' }}>
        {shown.map((slot) => (
          <SpriteCell key={slot} slot={slot} busy={busy === slot} onRestore={() => void restore(slot)} onUpload={async (file) => {
            setBusy(slot);
            try {
              await api.uploadSprite(slot, file);
              setNotice(`${slot} updated — refresh a quest to see it.`);
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

function SpriteCell({ slot, busy, onRestore, onUpload }: { slot: string; busy: boolean; onRestore: () => void; onUpload: (f: File) => void }) {
  return (
    <div style={{ textAlign: 'center', border: '1px solid rgba(255,255,255,0.15)', padding: '0.4rem' }}>
      <img src={spriteDataUrl(slot)} alt={slot} style={{ width: 48, height: 48, imageRendering: 'pixelated', objectFit: 'contain' }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
      <p className="term-font" style={{ fontSize: '0.7rem', margin: '0.25rem 0', wordBreak: 'break-all' }}>{slot}</p>
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
        <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} onClick={onRestore} disabled={busy} title="Restore from canonical grid">↺</button>
      </div>
    </div>
  );
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

// --- the panel ---------------------------------------------------------------------------

export default function AdminPanel({ onExit }: { onExit?: () => void }) {
  const [tab, setTab] = useState<Tab>('features');
  const [themes, setThemes] = useState<ThemeMeta[]>([]);
  useEffect(() => { api.getThemes().then((r) => setThemes(r.themes)).catch(() => setThemes([])); }, []);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="pixel-panel" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <p className="pixel-font" style={{ fontSize: '0.85rem', margin: '0.25rem 0.5rem 0 0', color: 'var(--d-gold)' }}>👑 ADMIN</p>
        {(['features', 'sprites', 'map', 'shop'] as Tab[]).map((t) => (
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
      {tab === 'sprites' && <SpritesTab />}
      {tab === 'map' && <MapTab themes={themes} />}
      {tab === 'shop' && <ShopTab />}
    </div>
  );
}
