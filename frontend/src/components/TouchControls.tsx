import { useEffect, useRef } from 'react';
import type { ArcadeEngine } from '../game/engine';

interface Props {
  /** The live engine instance — null until the level finishes mounting. */
  engine: ArcadeEngine | null;
}

/**
 * On-screen D-pad for touch devices (phones/tablets): ◀ ▶ on the left,
 * JUMP on the right. Rendered only when a coarse pointer exists, so desktop
 * keyboards stay the primary control and the pad never clutters the HUD.
 *
 * Pointer events (not click/touchstart) give us: multi-touch (run + jump at
 * once), slide-off releases (pointerleave/pointercancel), and mouse testing
 * on desktop. `touch-action: none` stops scroll/zoom gestures from stealing
 * a held direction.
 */
export default function TouchControls({ engine }: Props) {
  const heldRef = useRef<{ left: boolean; right: boolean; jump: boolean }>({ left: false, right: false, jump: false });

  // Safety net: if the controls unmount mid-press (dialog opened, level ended),
  // drop every flag so the knight doesn't keep running into a wall.
  useEffect(() => () => engine?.clearTouchInput(), [engine]);

  function apply(next: Partial<typeof heldRef.current>) {
    heldRef.current = { ...heldRef.current, ...next };
    engine?.setTouchInput(heldRef.current);
  }

  function press(key: 'left' | 'right' | 'jump') {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      apply({ [key]: true });
    };
  }

  function release(key: 'left' | 'right' | 'jump') {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      apply({ [key]: false });
    };
  }

  const btn: React.CSSProperties = {
    width: 64,
    height: 64,
    fontSize: '1.3rem',
    lineHeight: 1,
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
  };

  return (
    <div
      className="touch-controls"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '0.6rem',
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          aria-label="Move left"
          className="pixel-btn pixel-btn--ghost touch-btn"
          style={btn}
          onPointerDown={press('left')}
          onPointerUp={release('left')}
          onPointerLeave={release('left')}
          onPointerCancel={release('left')}
          onContextMenu={(e) => e.preventDefault()}
        >
          ◀
        </button>
        <button
          type="button"
          aria-label="Move right"
          className="pixel-btn pixel-btn--ghost touch-btn"
          style={btn}
          onPointerDown={press('right')}
          onPointerUp={release('right')}
          onPointerLeave={release('right')}
          onPointerCancel={release('right')}
          onContextMenu={(e) => e.preventDefault()}
        >
          ▶
        </button>
      </div>
      <button
        type="button"
        aria-label="Jump"
        className="pixel-btn pixel-btn--primary touch-btn touch-btn--jump"
        style={{ ...btn, width: 84 }}
        onPointerDown={press('jump')}
        onPointerUp={release('jump')}
        onPointerLeave={release('jump')}
        onPointerCancel={release('jump')}
        onContextMenu={(e) => e.preventDefault()}
      >
        ⤒ JUMP
      </button>
    </div>
  );
}
