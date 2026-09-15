import { useEffect, useState } from 'react';

/**
 * "Rotate your phone" hint for portrait phones DURING a quest. The platformer
 * plays far better landscape (wider view of pits/monsters), so we nudge once
 * per session and never block the game — dismissable, auto-hides on rotate.
 */
export default function LandscapeHint({ active }: { active: boolean }) {
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [nagged, setNagged] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 768px)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // Nudge at most once per session; after that the player has made their choice.
  useEffect(() => {
    if (portrait && active && !dismissed && !nagged) {
      setNagged(true);
      const t = window.setTimeout(() => setDismissed(true), 6000);
      return () => window.clearTimeout(t);
    }
  }, [portrait, active, dismissed, nagged]);

  if (!active || dismissed || !portrait) return null;

  return (
    <button
      type="button"
      className="landscape-hint"
      onClick={() => setDismissed(true)}
      aria-label="Rotate your phone to landscape for a wider view — tap to dismiss"
    >
      <span style={{ fontSize: '1.6rem' }}>🔄</span>
      <span className="pixel-font" style={{ fontSize: '0.55rem' }}>
        ROTATE FOR A WIDER REALM
      </span>
      <span className="term-font" style={{ fontSize: '0.85rem', color: 'var(--d-stone-light)' }}>
        tap to dismiss
      </span>
    </button>
  );
}
