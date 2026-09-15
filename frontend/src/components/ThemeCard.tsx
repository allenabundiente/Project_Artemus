import { useMemo } from 'react';
import type { ThemeMeta } from '../types';
import { spriteDataUrl } from '../game/sprites';
import { SPRITES } from '../game/spriteGrids';
import { AVATAR_GRIDS } from '../game/avatarGrids';

/**
 * A preview card for a map theme: a mini landscape painted from the theme's
 * palette plus (when the theme swaps art) before→after monster previews.
 * Used by the teacher's guild-skin browser; built-ins preview from their
 * hardcoded palettes.
 */
export default function ThemeCard({
  theme,
  selected,
  onPick,
}: {
  theme: ThemeMeta;
  selected?: boolean;
  onPick?: () => void;
}) {
  const palette = useMemo(() => {
    // Built-in palettes mirror frontend/src/game/themes.ts.
    if (theme.builtin) {
      if (theme.id === 'forest') {
        return {
          sky: '#1c2a1c', stars: '#cdeab0', farHills: '#2c4226', nearHills: '#4a6b3a',
          pit: '#08120a', floorTop: '#6f4a1f', floorBody: '#3a2c22', floorSpeckle: '#4f3a2b',
        };
      }
      return {
        sky: '#2a1f2e', stars: '#f2e8d5', farHills: '#4f2a25', nearHills: '#3f5d3a',
        pit: '#000000', floorTop: '#8b5a2b', floorBody: '#5c554e', floorSpeckle: '#706a62',
      };
    }
    return {
      sky: theme.sky ?? '#2a1f2e',
      stars: theme.stars ?? '#f2e8d5',
      farHills: theme.farHills ?? '#4f2a25',
      nearHills: theme.nearHills ?? '#3f5d3a',
      pit: theme.pit ?? '#000000',
      floorTop: theme.floorTop ?? '#8b5a2b',
      floorBody: theme.floorBody ?? '#5c554e',
      floorSpeckle: theme.floorSpeckle ?? '#706a62',
    };
  }, [theme]);

  // Sprite-art sources: grid slots render from the in-code rasters (always
  // available), custom uploads from their PNG files.
  const gridSlots = useMemo(() => new Set([...SPRITES, ...AVATAR_GRIDS].map((s) => s.name)), []);
  const slotSrc = (s: string) => (gridSlots.has(s) ? spriteDataUrl(s) : `/sprites/${s}.png`);

  const monsters = (theme.monsters ?? []).filter((s) => /^[a-z0-9_]+$/.test(s)).slice(0, 3);

  return (
    <div
      style={{
        border: selected ? '3px solid var(--d-gold)' : '1px solid rgba(255,255,255,0.15)',
        padding: '0.5rem',
        cursor: onPick ? 'pointer' : 'default',
        textAlign: 'center',
      }}
      onClick={onPick}
    >
      {/* mini landscape */}
      <div
        style={{
          position: 'relative',
          height: 72,
          overflow: 'hidden',
          background: palette.sky,
          marginBottom: '0.4rem',
        }}
      >
        {[8, 40, 72, 104].map((x, i) => (
          <div key={x} style={{ position: 'absolute', left: x, top: 6, width: 2, height: 2, background: palette.stars }} />
        ))}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 24, height: 18, background: palette.farHills }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 10, height: 16, background: palette.nearHills }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, background: palette.floorTop }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, background: palette.floorBody, zIndex: -1 }} />
        <div style={{ position: 'absolute', left: 10, bottom: 2, width: 18, height: 2, background: palette.floorSpeckle }} />
        <div style={{ position: 'absolute', left: 90, bottom: 4, width: 12, height: 2, background: palette.floorSpeckle }} />
        {/* patrol monsters */}
        {monsters.map((m, i) => (
          <img
            key={`${m}-${i}`}
            src={slotSrc(m)}
            alt={m}
            title={m}
            style={{
              position: 'absolute',
              left: 130 + i * 22,
              bottom: 2,
              width: 20,
              height: 20,
              imageRendering: 'pixelated',
              objectFit: 'contain',
            }}
          />
        ))}
      </div>

      <p className="pixel-font" style={{ fontSize: '0.55rem', margin: 0 }}>
        {selected ? '★ ' : ''}{theme.name}
      </p>
      <p className="term-font" style={{ fontSize: '0.7rem', color: 'var(--d-stone-light)', margin: 0 }}>
        {theme.builtin ? 'built-in realm' : `custom realm · ${theme.monsters?.length ?? 0} patrol monster${(theme.monsters?.length ?? 0) === 1 ? '' : 's'}`}
      </p>
      {selected && (
        <p className="term-font" style={{ fontSize: '0.7rem', color: 'var(--d-gold)', margin: '0.2rem 0 0' }}>
          current guild skin
        </p>
      )}
    </div>
  );
}
