import { useState } from 'react';
import type { Challenge } from '../types';
import { sfx } from '../game/sfx';
import { spriteDataUrl } from '../game/sprites';
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

export default function BattleScreen({ queue, maxHp, lives, boss = false, onDamage, onHit, onRetreat, onVictory }: Props) {
  const [monsterHp, setMonsterHp] = useState(maxHp);
  const [qIndex, setQIndex] = useState(0);
  /** Remount counter: a fresh attempt at the same question after a wrong answer. */
  const [attempt, setAttempt] = useState(0);
  const [hurt, setHurt] = useState(false);
  const [victory, setVictory] = useState(false);
  const [message, setMessage] = useState(
    boss ? 'THE DUNGEON BOSS AWAKENS!' : 'A GOBLISH MONSTER BLOCKS YOUR PATH!'
  );

  const monsterName = boss ? 'DUNGEON BOSS' : 'MONSTER';
  const challenge = queue[Math.min(qIndex, queue.length - 1)];

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
      setMessage(boss ? 'THE DUNGEON BOSS BITES BACK!' : 'THE MONSTER BITES!');
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
        {boss ? '⚠ DUNGEON BOSS' : '⚔ MONSTER BATTLE'}
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
            src={spriteDataUrl(hurt ? 'bookworm_hurt' : boss ? 'boss' : 'enemy_goblin')}
            alt={monsterName}
            style={{
              width: boss ? 96 : 72,
              height: boss ? 96 : 72,
              imageRendering: 'pixelated',
              transform: hurt ? 'translateX(4px)' : undefined,
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
