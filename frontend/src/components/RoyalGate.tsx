import { useEffect, useState } from 'react';
import * as api from '../api';
import { spriteDataUrl } from '../game/sprites';

interface Props {
  feature: string;
  children: React.ReactNode;
}

/**
 * Gates a whole view behind the admin's feature lock. While locked, players
 * see the royal decree instead of the feature; teachers/admins are spared —
 * they need access to manage things.
 */
export default function RoyalGate({ feature, children }: Props) {
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getFeatures()
      .then((rows) => { if (!cancelled) setLocked(rows.find((r) => r.key === feature)?.locked ?? false); })
      .catch(() => { if (!cancelled) setLocked(false); }); // fail open — never soft-lock the game
    return () => { cancelled = true; };
  }, [feature]);

  if (locked === null) return null;
  if (!locked) return <>{children}</>;

  return (
    <div className="pixel-panel royal-gate" style={{ maxWidth: 480, margin: '2rem auto', textAlign: 'center', padding: '2rem 1.5rem' }}>
      <img src={spriteDataUrl('castle_gate')} alt="" style={{ width: 48, height: 48, imageRendering: 'pixelated', marginBottom: '0.75rem' }} />
      <p className="pixel-font" style={{ fontSize: '0.95rem', color: 'var(--d-gold)', margin: '0 0 0.75rem' }}>
        ⚔ ROYAL DECREE ⚔
      </p>
      <p className="term-font" style={{ fontSize: '1.05rem', margin: 0 }}>
        This area has been locked by his majesty, please return to the hall.
      </p>
    </div>
  );
}
