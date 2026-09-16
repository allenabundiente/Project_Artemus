// Shared live avatar sprite used everywhere a profile renders: dashboards,
// leaderboard rows, guild roster. Loads sprites once and animates the idle
// cycle; falls back to a silhouette-sized placeholder while loading.
import { useEffect, useState } from 'react';
import type { AvatarPrefs } from '../types';
import { composeAvatar, type AvatarFrame } from '../game/avatar';
import { loadSprites, type SpriteMap } from '../game/sprites';

export const DEFAULT_AVATAR: AvatarPrefs = {
  sex: 'male', hair: 'short', armor: 'tunic', helmet: 'none', cape: 'none', color: '#e8b43c',
};

interface Props {
  avatar?: AvatarPrefs;
  /** Rendered pixel size (square). */
  size?: number;
  /** Animate the idle/run cycle; static idle when false. */
  animate?: boolean;
  title?: string;
}

let spriteMapPromise: Promise<SpriteMap> | null = null;
// Resolved-map cache: once ANY avatar has loaded, every later mount (guild
// rows, leaderboard, dashboard) initializes synchronously from this — no
// empty-placeholder flash between mount and the async resolve.
let spriteMapCache: SpriteMap | null = null;
function spritesOnce(): Promise<SpriteMap> {
  spriteMapPromise ??= loadSprites().then((s) => {
    spriteMapCache = s;
    return s;
  });
  return spriteMapPromise;
}

export default function AvatarSprite({ avatar, size = 24, animate = true, title }: Props) {
  const [sprites, setSprites] = useState<SpriteMap | null>(spriteMapCache);
  const [frame, setFrame] = useState<AvatarFrame>('idle');

  useEffect(() => {
    if (sprites) return; // resolved synchronously from the cache
    let cancelled = false;
    void spritesOnce().then((s) => { if (!cancelled) setSprites(s); });
    return () => { cancelled = true; };
  }, [sprites]);

  useEffect(() => {
    if (!animate) return;
    const t = window.setInterval(() => {
      setFrame((f) => (f === 'idle' ? 'run1' : f === 'run1' ? 'run2' : f === 'run2' ? 'run3' : f === 'run3' ? 'run4' : 'idle'));
    }, 350);
    return () => window.clearInterval(t);
  }, [animate]);

  if (!sprites) return <span style={{ display: 'inline-block', width: size, height: size }} aria-hidden />;
  const cv = composeAvatar(frame, avatar ?? DEFAULT_AVATAR, sprites);
  return (
    <img
      src={cv.toDataURL()}
      alt={title ?? 'Adventurer avatar'}
      title={title}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', verticalAlign: 'middle' }}
    />
  );
}
