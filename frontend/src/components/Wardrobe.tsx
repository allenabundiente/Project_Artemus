import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { AvatarPart, AvatarPrefs, AvatarSetDef, WardrobeResponse } from '../types';
import { composeAvatar, type AvatarConfig, type AvatarFrame } from '../game/avatar';

interface Props {
  initial: AvatarPrefs;
  onSaved: (avatar: AvatarPrefs) => void;
}

const PART_LABEL: Record<AvatarPart, string> = { hair: '💇 HAIR', armor: '🛡 ARMOR', helmet: '⛑ HELMET', cape: '🧣 CAPE' };

const PART_ORDER: AvatarPart[] = ['armor', 'hair', 'helmet', 'cape'];

/** Themed color picker: heraldic swatches + a native color input styled to match. */
function ColorPicker({ colors, value, onChange }: { colors: { hex: string; name: string }[]; value: string; onChange: (hex: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
      {colors.map((c) => (
        <button
          key={c.hex}
          title={c.name}
          onClick={() => onChange(c.hex)}
          style={{
            width: 24,
            height: 24,
            background: c.hex,
            border: value.toLowerCase() === c.hex ? '2px solid var(--d-gold, #ffd700)' : '2px solid #1a1a1a',
            cursor: 'pointer',
            imageRendering: 'pixelated',
            padding: 0,
          }}
        />
      ))}
      <label
        title="Custom color"
        style={{
          position: 'relative',
          width: 24,
          height: 24,
          display: 'inline-block',
          border: '2px dashed #6a6a6a',
          cursor: 'pointer',
          background: 'conic-gradient(#a82a2a, #e8b43c, #3f5d3a, #7fb3cb, #c95d7a, #a82a2a)',
        }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
        />
      </label>
    </div>
  );
}

/** One row of set choices for a part; locked sets show their price. */
function SetChooser({ part, sets, unlocked, avatar, onPick, onGoShopping }: {
  part: AvatarPart;
  sets: AvatarSetDef[];
  unlocked: string[];
  avatar: AvatarPrefs;
  onPick: (id: string) => void;
  onGoShopping: () => void;
}) {
  return (
    <div className="pixel-panel" style={{ marginBottom: '1rem' }}>
      <p className="pixel-font" style={{ fontSize: '0.7rem', margin: '0 0 0.5rem' }}>{PART_LABEL[part]}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem' }}>
        {sets.map((s) => {
          const isUnlocked = unlocked.includes(s.id);
          const isSelected = avatar[part] === s.id;
          return (
            <button
              key={s.id}
              onClick={() => (isUnlocked ? onPick(s.id) : onGoShopping())}
              title={isUnlocked ? s.description : `${s.description} — unlock in the shop for ${s.price} 🪙`}
              className="pixel-btn pixel-btn--ghost"
              style={{
                textTransform: 'none',
                fontSize: '0.6rem',
                textAlign: 'left',
                borderColor: isSelected ? 'var(--d-gold, #ffd700)' : undefined,
                opacity: isUnlocked ? 1 : 0.55,
              }}
            >
              {isSelected ? '▸ ' : ''}{s.name}
              {!isUnlocked && <span style={{ color: 'var(--d-gold, #ffd700)' }}> · {s.price} 🪙</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Wardrobe({ initial, onSaved }: Props) {
  const [data, setData] = useState<WardrobeResponse | null>(null);
  const [avatar, setAvatar] = useState<AvatarPrefs>(initial);
  const [sprites, setSprites] = useState<Record<string, HTMLImageElement> | null>(null);
  const [frame, setFrame] = useState<AvatarFrame>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getWardrobe()
      .then((w) => {
        if (cancelled) return;
        setData(w);
        setAvatar(w.avatar);
      })
      .catch((e) => setError((e as Error).message));
    import('../game/sprites').then((m) => m.loadSprites()).then((s) => { if (!cancelled) setSprites(s); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      setFrame((f) => (f === 'idle' ? 'run1' : f === 'run1' ? 'run2' : 'idle'));
    }, 350);
    return () => window.clearInterval(t);
  }, []);

  const save = useCallback(async (next: AvatarPrefs) => {
    setAvatar(next);
    setSaving(true);
    setError(null);
    try {
      await api.saveWardrobe(next);
      onSaved(next);
      setNotice('Look saved!');
      window.setTimeout(() => setNotice(null), 1800);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [onSaved]);

  const patch = (p: Partial<AvatarPrefs>) => void save({ ...avatar, ...p });

  if (error && !data) {
    return <div className="pixel-panel" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}><p className="error-text">{error}</p></div>;
  }
  if (!data) return <p className="pixel-font" style={{ textAlign: 'center', marginTop: '2rem' }}>OPENING THE WARDROBE…</p>;

  const goShop = () => window.dispatchEvent(new CustomEvent('arcade:goto-shop'));

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="pixel-panel" style={{ marginBottom: '1rem' }}>
        <p className="pixel-font" style={{ fontSize: '0.8rem', margin: '0 0 0.75rem' }}>👗 THE WARDROBE</p>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* live preview: the equipped look, animating */}
          <div
            style={{
              width: 128,
              height: 128,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--d-black)',
              border: '3px solid var(--d-darkwood)',
              outline: '2px solid var(--d-gold)',
              outlineOffset: -5,
              flexShrink: 0,
            }}
          >
            {sprites ? (
              <img src={composeAvatar(frame, avatar, sprites).toDataURL()} width={112} height={112} alt="Your hero" style={{ imageRendering: 'pixelated' }} />
            ) : (
              <div style={{ width: 112, height: 112 }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
              {(['male', 'female'] as const).map((sex) => (
                <button
                  key={sex}
                  className="pixel-btn pixel-btn--ghost"
                  style={{ fontSize: '0.6rem', borderColor: avatar.sex === sex ? 'var(--d-gold, #ffd700)' : undefined }}
                  onClick={() => patch({ sex })}
                  disabled={saving}
                >
                  {sex === 'male' ? '♂ KNIGHT' : '♀ ROGUE'}
                </button>
              ))}
            </div>
            <p className="pixel-font" style={{ fontSize: '0.55rem', margin: '0 0 0.4rem', color: 'var(--d-gold)' }}>🎨 BANNER COLOR</p>
            <ColorPicker colors={data.colors} value={avatar.color} onChange={(hex) => patch({ color: hex })} />
            <p className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-stone-light)', margin: '0.6rem 0 0' }}>
              {saving ? 'Saving…' : notice ?? 'Pick a look — it saves instantly and rides with you everywhere.'}
            </p>
          </div>
        </div>
      </div>

      {PART_ORDER.map((part) => (
        <SetChooser
          key={part}
          part={part}
          sets={data.sets[part] ?? []}
          unlocked={data.unlocked[part] ?? []}
          avatar={avatar}
          onPick={(id) => patch({ [part]: id })}
          onGoShopping={goShop}
        />
      ))}
    </div>
  );
}
