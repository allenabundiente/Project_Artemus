import { useEffect, useRef } from 'react';
import type { ArcadeEngine } from '../game/engine';

interface Props {
  /** The live engine instance — null until the level finishes mounting. */
  engine: ArcadeEngine | null;
}

/**
 * On-screen D-pad for touch devices (phones/tablets): ◀ ▶ bottom-left,
 * JUMP bottom-right — rendered as an OVERLAY floating over the game canvas
 * (absolute inside the canvas wrapper), never as a block that shoves the
 * canvas up the page. Only shown when a coarse pointer exists, so desktop
 * keyboards stay the primary control and the pad never clutters the HUD.
 *
 * Pointer events (not click/touchstart) give us: multi-touch (run + jump at
 * once), slide-off releases (pointerleave/pointercancel), and mouse testing
 * on desktop. `touch-action: none` stops scroll/zoom gestures from stealing
 * a held direction; the overlay itself is pointer-transparent so taps between
 * buttons pass through to the page.
 */
export default function TouchControls({ engine }: Props) {
  const heldRef = useRef<{ left: boolean; right: boolean; jump: boolean }>({ left: false, right: false, jump: false });

  // Safety net: if the controls unmount mid-press (dialog opened, level ended),
  // drop every flag so the knight doesn't keep running into a wall.
  useEffect(() => () => engine?.clearTouchInput(), [engine]);

  /** Short buzz on press (Android/Chrome; iOS Safari ignores it silently). */
  function buzz(ms = 12) {
    try { navigator.vibrate?.(ms); } catch { /* unsupported — fine */ }
  }

  function apply(next: Partial<typeof heldRef.current>) {
    heldRef.current = { ...heldRef.current, ...next };
    engine?.setTouchInput(heldRef.current);
  }

  function press(key: 'left' | 'right' | 'jump') {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      buzz(key === 'jump' ? 18 : 10);
      apply({ [key]: true });
    };
  }

  function release(key: 'left' | 'right' | 'jump') {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      apply({ [key]: false });
    };
  }

  // 60px square (well past the 44px minimum, comfortably thumb-sized); JUMP is
  // wider — it's the most-pressed button mid-fight. `whiteSpace: nowrap` keeps
  // the label from wrapping/popping out of the button on narrow screens.
  const btn: React.CSSProperties = {
    width: 60,
    height: 60,
    fontSize: '1.5rem',
    lineHeight: 1,
    padding: 0,
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
  };

  return (
    <div className="touch-controls touch-controls--overlay">
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
        style={{ ...btn, width: 96, height: 60, fontSize: '1.05rem', whiteSpace: 'nowrap', letterSpacing: '0.05em' }}
        onPointerDown={press('jump')}
        onPointerUp={release('jump')}
        onPointerLeave={release('jump')}
        onPointerCancel={release('jump')}
        onContextMenu={(e) => e.preventDefault()}
      >
        JUMP
      </button>
    </div>
  );
}
