import { useEffect, useState } from 'react';
import type { Challenge } from '../types';
import { sfx } from '../game/sfx';
import { spriteDataUrl, isCanonicalSprite } from '../game/sprites';
import ChallengeDialog from './ChallengeDialog';

interface Props {
  /**
   * This monster's dealt question queue — exactly one DISTINCT challenge per
   * heart (regular battles get it from the run's no-repeat deal; the boss gets
   * the challenges the student already faced earlier in the run).
   */
  queue: Challenge[];
  /** Hearts the monster starts with (queue length). */
  maxHp: number;
  /** Sprite slot of the monster being fought (theme roster may swap it). */
  monsterSlot?: string;
  /** Player hearts (mirrored from the engine). */
  lives: number;
  /** Boss variant: bigger monster, level ends on victory. */
  boss?: boolean;
  /** Player took a hit (wrong answer). */
  onDamage: () => void;
  /** A correct answer landed a hit on the monster (regular battles only — the engine tracks hearts). */
  onHit?: () => void;
  /** Player retreats a step (battle dismissed without victory). */
  onRetreat: () => void;
  /** Monster defeated. */
  onVictory: () => void;
}

export default function BattleScreen({ queue, maxHp, lives, boss = false, onDamage, onHit, onRetreat, onVictory, monsterSlot }: Props) {
  // A theme's roster can swap the classic goblin for any sprite slot. Slots
  // with a canonical grid (goblin, slime, bat, EMBER, LAVA DRAGON…) always
  // render via spriteDataUrl's rasterizer — no phantom risk. Custom uploads
  // are probed asynchronously; until the probe lands we show the classic art
  // (the old synchronous `new Image()` probe was NEVER complete on first
  // paint, so the battle flashed goblin → real monster on every encounter).
  const canonical = !!monsterSlot && isCanonicalSprite(monsterSlot);
  useSpriteProbe(monsterSlot, canonical);
  const art = monsterSlot && (canonical || spriteLoads(monsterSlot)) ? monsterSlot : 'enemy_goblin';
  const [monsterHp, setMonsterHp] = useState(maxHp);
  const [qIndex, setQIndex] = useState(0);
  /** Remount counter: a fresh attempt at the same question after a wrong answer. */
  const [attempt, setAttempt] = useState(0);
  const [hurt, setHurt] = useState(false);
  const [victory, setVictory] = useState(false);
  // Battle copy follows the theme roster, not just the art.
  const monsterName = boss
    ? monsterSlot === 'lava_dragon_boss'
      ? 'LAVA DRAGON'
      : 'DUNGEON BOSS'
    : art === 'enemy_ember' ? 'EMBER IMP'
    : art === 'lava_dragon' ? 'LAVA DRAGON'
    : art === 'enemy_slime' ? 'SLIME'
    : art === 'enemy_bat' ? 'CAVE BAT'
    : 'MONSTER';
  const challenge = queue[Math.min(qIndex, queue.length - 1)];
  const [message, setMessage] = useState(
    boss
      ? monsterSlot === 'lava_dragon_boss' ? 'THE LAVA DRAGON AWAKENS!' : 'THE DUNGEON BOSS AWAKENS!'
      : `${monsterName} BLOCKS YOUR PATH!`
  );

  function handleResult(correct: boolean) {
    if (correct) {
      sfx.slash();
      setHurt(true);
      window.setTimeout(() => setHurt(false), 250);
      const hp = monsterHp - 1;
      setMonsterHp(hp);
      if (hp <= 0) {
        setMessage(`${monsterName} IS DEFEATED!`);
        setVictory(true);
      } else {
        onHit?.(); // engine removes one heart from this monster
        setMessage(`DIRECT HIT! (${hp} ${hp === 1 ? 'HEART' : 'HEARTS'} LEFT)`);
        // Next question = next heart. The queue is pre-dealt and distinct per
        // heart, so a multi-heart monster never shows the same question twice.
        setQIndex((i) => Math.min(i + 1, queue.length - 1));
      }
    } else {
      onDamage(); // engine plays the hit sound + updates hearts
      setMessage(
        boss
          ? monsterSlot === 'lava_dragon_boss' ? 'THE LAVA DRAGON BITES BACK!' : 'THE DUNGEON BOSS BITES BACK!'
          : `${monsterName} BITES!`
      );
    }
  }

  function handleDismiss() {
    if (victory) {
      onVictory();
      return;
    }
    // Wrong answer: the same question comes back for another attempt (the
    // monster keeps its hearts — only correct answers land hits).
    setAttempt((a) => a + 1);
  }

  return (
    <div className="dialog-box" style={{ maxWidth: 660, margin: '0 auto' }}>
      <div className="pixel-font" style={{ fontSize: '0.6rem', color: boss ? 'var(--p-red)' : 'var(--p-pink)', marginBottom: '0.5rem' }}>
        {boss ? (monsterSlot === 'lava_dragon_boss' ? '⚠ LAVA DRAGON' : '⚠ DUNGEON BOSS') : '⚔ MONSTER BATTLE'}
      </div>

      {/* monster stage */}
      <div
        style={{
          background: 'var(--p-black)',
          border: `3px solid ${boss ? 'var(--p-red)' : 'var(--p-green)'}`,
          padding: '0.75rem',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <img
            key={hurt ? 'hurt' : 'ok'}
            src={spriteDataUrl(hurt && art === 'enemy_goblin' && !boss ? 'bookworm_hurt' : boss ? (monsterSlot ?? 'boss') : art)}
            alt={monsterName}
            style={{
              width: boss ? 96 : 72,
              height: boss ? 96 : 72,
              imageRendering: 'pixelated',
              // Themed monsters/bosses shake in place (no hurt frames exist
              // for them); only the classic goblin swaps to its comic face.
              transform: hurt ? (boss || art !== 'enemy_goblin' ? 'translateX(6px) scale(0.96)' : 'translateX(4px)') : undefined,
            }}
          />
          <div className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--p-peach)', marginTop: '0.3rem' }}>
            {monsterName}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--p-yellow)', marginBottom: '0.3rem' }}>
            HEARTS
          </div>
          <div className="boss-hp" style={{ justifyContent: 'flex-end' }}>
            {Array.from({ length: maxHp }, (_, i) => (
              <img
                key={i}
                src={spriteDataUrl(i < monsterHp ? 'heart' : 'heart_empty')}
                alt=""
                style={{ width: 18, height: 14, imageRendering: 'pixelated' }}
              />
            ))}
          </div>
          <div className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--p-blue)', margin: '0.5rem 0 0.3rem' }}>
            YOU
          </div>
          <div style={{ display: 'flex', gap: '0.15rem', justifyContent: 'flex-end' }}>
            {Array.from({ length: 3 }, (_, i) => (
              <img
                key={i}
                src={spriteDataUrl(i < lives ? 'heart' : 'heart_empty')}
                alt=""
                style={{ width: 14, height: 11, imageRendering: 'pixelated' }}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="status-text" style={{ margin: '0.7rem 0 0.6rem', fontSize: '1rem' }}>{message}</p>

      {victory ? (
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="pixel-btn pixel-btn--primary" onClick={handleDismiss}>
            {boss ? 'CLAIM THE TREASURE ★' : 'MONSTER DEFEATED ▶'}
          </button>
        </div>
      ) : (
        <>
          <ChallengeDialog
            key={`${attempt}-${qIndex}-${monsterHp}`}
            challenge={challenge}
            onResult={handleResult}
            onDismiss={handleDismiss}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button className="pixel-btn pixel-btn--ghost" onClick={onRetreat} title="Run away from this battle">
              FLEE ▶
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** True once the given slot's PNG is confirmed present on the server. */
function spriteLoads(slot: string): boolean {
  const probe = new Image();
  probe.src = `/sprites/${slot}.png`;
  return probe.complete && probe.naturalWidth > 0;
}

/**
 * Re-render once custom-slot PNG probes settle, so a battle that started on
 * the fallback art swaps to the real (admin-uploaded) monster when it loads.
 * Canonical-grid slots skip this entirely — they render synchronously.
 */
function useSpriteProbe(slot: string | undefined, canonical: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!slot || canonical) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => { if (alive) force((n) => n + 1); };
    probe.src = `/sprites/${slot}.png`;
    return () => { alive = false; };
  }, [slot, canonical]);
}


