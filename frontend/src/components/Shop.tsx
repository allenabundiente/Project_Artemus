import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AuthUser, ShopItem } from '../types';
import { spriteDataUrl } from '../game/sprites';
import { composeAvatar, type AvatarConfig, type AvatarFrame } from '../game/avatar';
import { celebratePurchase } from '../game/celebrate';
import { onHudCoins } from '../game/hudCoins';

interface Props {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
}

/** Tiny live preview of the player's avatar (idle frame). */
function AvatarPreview({ avatar, size = 64 }: { avatar: AvatarConfig; size?: number }) {
  const [frame, setFrame] = useState<AvatarFrame>('idle');
  const [sprites, setSprites] = useState<Record<string, HTMLImageElement> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getWardrobe().catch(() => null);
    import('../game/sprites').then((m) => m.loadSprites()).then((s) => { if (!cancelled) setSprites(s); });
    const t = window.setInterval(() => {
      setFrame((f) => (f === 'idle' ? 'run1' : f === 'run1' ? 'run2' : f === 'run2' ? 'run3' : f === 'run3' ? 'run4' : 'idle'));
    }, 350);
    return () => { cancelled = true; window.clearInterval(t); };
  }, []);

  if (!sprites) return <div style={{ width: size, height: size }} />;
  const cv = composeAvatar(frame, avatar, sprites);
  return (
    <img
      src={cv.toDataURL()}
      alt="Your hero"
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

const CATEGORY_LABEL: Record<ShopItem['category'], string> = {
  hair: '💇 Hair',
  armor: '🛡 Armor',
  helmet: '⛑ Helmets',
  cape: '🧣 Capes',
  pack: '📦 Bundles',
};

export default function Shop({ user, onUserUpdated }: Props) {
  const [coins, setCoins] = useState(user.coins);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Celebrations must not re-fire when refresh() re-renders the list — gate on
  // the exact server-confirmed purchase that just happened (itemId+price+coins).
  const lastCelebrated = useRef('');

  const refresh = useCallback(async () => {
    try {
      const s = await api.getShop();
      setItems(s.items);
      setOwned(s.owned);
      setCoins(s.coins);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // The celebration (and any other coin event) can push a new balance straight
  // to this HUD — no refetch needed.
  useEffect(() => onHudCoins((c) => {
    setCoins(c);
    onUserUpdated({ ...user, coins: c });
  }), [user, onUserUpdated]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function buy(item: ShopItem) {
    setError(null);
    setNotice(null);
    setBusy(item.id);
    try {
      const r = await api.purchaseItem(item.id);
      setCoins(r.coins);
      onUserUpdated({ ...user, coins: r.coins });
      setNotice(`${item.name} unlocked! Visit the Wardrobe to wear it.`);
      // Celebrate exactly once per confirmed purchase, before the refetch can
      // stomp the balance (celebratePurchase also bumps every coin HUD).
      const key = `${item.id}:${r.coins}`;
      if (lastCelebrated.current !== key) {
        lastCelebrated.current = key;
        celebratePurchase({ itemName: item.name, price: item.price, coins: r.coins });
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const categories: ShopItem['category'][] = ['hair', 'armor', 'helmet', 'cape', 'pack'];

  // First paint on slow phones: the fetch hasn't landed yet. Render a skeleton
  // with the real panel chrome instead of collapsing to just the header (the
  // old flash: header → full list a beat later = layout jump).
  const loaded = items.length > 0;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="pixel-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p className="pixel-font" style={{ fontSize: '0.9rem', margin: 0 }}>🪙 THE ROYAL SHOP</p>
        <p className="pixel-font" style={{ fontSize: '1rem', color: 'var(--d-gold)', margin: 0 }}>
          <img src={spriteDataUrl('coin')} alt="" style={{ width: 14, height: 14, marginRight: 4 }} />
          <span
            className="coin-count-value"
            data-coins={coins}
            style={{ display: 'inline-block', minWidth: '2ch', textAlign: 'right' }}
          >
            {coins}
          </span>
        </p>
      </div>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="status-text">{notice}</p>}

      {!loaded && (
        <div className="pixel-panel shop-skeleton" style={{ marginBottom: '1rem' }} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shop-skeleton__row" />
          ))}
        </div>
      )}

      {categories.map((cat) => {
        const list = items.filter((i) => i.category === cat);
        if (list.length === 0) return null;
        return (
          <div key={cat} className="pixel-panel" style={{ marginBottom: '1rem' }}>
            <p className="pixel-font" style={{ fontSize: '0.75rem', marginTop: 0 }}>{CATEGORY_LABEL[cat]}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {list.map((item) => {
                const isOwned = owned.includes(item.id);
                return (
                  <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ minWidth: 0 }}>
                      <p className="pixel-font" style={{ fontSize: '0.65rem', margin: 0 }}>{item.name}</p>
                      <p className="term-font" style={{ fontSize: '0.85rem', margin: 0, color: 'var(--d-stone-light)' }}>{item.description}</p>
                    </div>
                    {isOwned ? (
                      <span className="pixel-font" style={{ fontSize: '0.6rem', color: 'var(--d-green, #7fdc6a)', whiteSpace: 'nowrap' }}>✔ OWNED</span>
                    ) : (
                      <button
                        className="pixel-btn pixel-btn--gold"
                        style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
                        onClick={() => void buy(item)}
                        disabled={busy === item.id || coins < item.price}
                      >
                        {busy === item.id ? '…' : `${item.price} 🪙`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {items.length === 0 && !error && (
        <div className="pixel-panel" style={{ textAlign: 'center' }}>
          <p className="status-text" style={{ margin: 0 }}>The shop shelves are bare. The royal merchants restock soon.</p>
        </div>
      )}

      <div className="pixel-panel" style={{ textAlign: 'center' }}>
        <p className="pixel-font" style={{ fontSize: '0.7rem', margin: '0 0 0.5rem' }}>YOUR HERO</p>
        <AvatarPreview avatar={user.avatar ?? { sex: 'male', hair: 'short', armor: 'tunic', helmet: 'none', color: '#e8b43c' }} />
        <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0.5rem 0 0' }}>
          Purchases unlock wardrobe sets forever — coins never expire.
        </p>
      </div>
    </div>
  );
}
