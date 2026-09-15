import { useState } from 'react';
import type { Challenge } from '../types';
import { sfx } from '../game/sfx';
import { spriteDataUrl } from '../game/sprites';
import ChallengeDialog from './ChallengeDialog';

interface Props {
  /** Question pool for this battle (chapter challenges). */
  challenges: Challenge[];
  /** Sprite slot of the monster being fought (theme roster may swap it). */
  monsterSlot?: string;
  /** The challenge this monster leads with (regular battles). */
  leadChallenge?: Challenge;
  /** Player hearts (mirrored from the engine). */
  lives: number;
  /** Boss variant: bigger monster, level ends on victory. */
  boss?: boolean;
  /** Player took a hit (wrong answer). */
  onDamage: () => void;
  /** Player retreats a step (battle dismissed without victory). */
  onRetreat: () => void;
  /** Monster defeated. */
  onVictory: () => void;
}

const MONSTER_MAX_HP = 3;

export default function BattleScreen({ challenges, monsterSlot, leadChallenge, lives, boss = false, onDamage, onRetreat, onVictory }: Props) {
  // A theme's roster can swap the classic goblin for any sprite slot — but
  // only if that slot actually rendered on the map (PNG exists on disk).
  // Otherwise fall back to the classic monster art so battles never show a
  // phantom slot.
  const art = monsterSlot && spriteLoads(monsterSlot) ? monsterSlot : 'enemy_goblin';
  const [monsterHp, setMonsterHp] = useState(MONSTER_MAX_HP);
  const [qIndex, setQIndex] = useState(0);
  const [round, setRound] = useState(0);
  const [hurt, setHurt] = useState(false);
  const [victory, setVictory] = useState(false);
  const [message, setMessage] = useState(
    boss ? 'THE DUNGEON BOSS AWAKENS!' : 'A GOBLISH MONSTER BLOCKS YOUR PATH!'
  );

  const queue = useQueue(challenges, leadChallenge, boss);
  const monsterName = boss ? 'DUNGEON BOSS' : 'MONSTER';

  function handleResult(correct: boolean) {
    if (correct) {
      sfx.slash();
      setHurt(true);
      window.setTimeout(() => setHurt(false), 350);
      const hp = monsterHp - 1;
      setMonsterHp(hp);
      if (hp <= 0) {
        setMessage(`${monsterName} IS DEFEATED!`);
        setVictory(true);
      } else {
        setMessage(`DIRECT HIT! (${hp}/${MONSTER_MAX_HP} HP LEFT)`);
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
    // Battle continues: advance to the next question (wraps around).
    setQIndex((qIndex + 1) % queue.length);
    setRound((r) => r + 1);
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
            src={spriteDataUrl(hurt ? 'bookworm_hurt' : boss ? 'boss' : art)}
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
            HP
          </div>
          <div className="boss-hp" style={{ justifyContent: 'flex-end' }}>
            {Array.from({ length: MONSTER_MAX_HP }, (_, i) => (
              <div key={i} className={`hp-cell ${i < monsterHp ? '' : 'hp-cell--empty'}`} />
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
            key={`${qIndex}-${round}`}
            challenge={queue[qIndex]}
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

/** Bosses get the hardest questions first; regular monsters lead with their own challenge. */
function useQueue(challenges: Challenge[], lead: Challenge | undefined, boss: boolean): Challenge[] {
  const [queue] = useState(() => {
    if (boss) {
      const rank = { hard: 0, medium: 1, easy: 2 } as const;
      return [...challenges].sort((a, b) => rank[a.difficulty] - rank[b.difficulty]);
    }
    if (!lead) return [...challenges];
    const rest = challenges.filter((c) => c.id !== lead.id);
    return [lead, ...rest];
  });
  return queue;
}