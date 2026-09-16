import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarPrefs, ScoreResultResponse, Term } from '../types';
import * as api from '../api';
import { ArcadeEngine, buildLayout, BACKING_W, BACKING_H } from '../game/engine';
import { loadSprites, spriteDataUrl } from '../game/sprites';
import { getAnimations, loadExtraSprites } from '../game/animations';
import { dealQuestPlan, type QuestPlan } from '../game/questPlan';
import { sfx } from '../game/sfx';
import { loadCustomThemes, resolveTheme } from '../game/themes';
import BattleScreen from './BattleScreen';
import TouchControls from './TouchControls';
import LandscapeHint from './LandscapeHint';

interface Props {
  bookId: string;
  chapterId: string;
  chapterIdx: number;
  term: Term;
  avatar?: AvatarPrefs;
  onExit: () => void;
  onComplete: (chapterId: string, result: ScoreResultResponse) => void;
  /** Fail settled server-side — lets the dashboard sync the new coin balance. */
  onFailSettled?: (chapterId: string, result: ScoreResultResponse) => void;
}

type Phase = 'loading' | 'playing' | 'battle' | 'boss' | 'won' | 'gameover';

/** What the Game Over popup shows once the fail has been recorded. */
interface FailOutcome {
  reason: 'out_of_lives' | 'out_of_time';
  result: ScoreResultResponse;
  coinsGathered: number;
}

export default function LevelScreen({ bookId, chapterId, chapterIdx, term, avatar, onExit, onComplete, onFailSettled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ArcadeEngine | null>(null);
  /** Per-run dealt plan: distinct challenge per heart + the boss repeat queue. */
  const planRef = useRef<QuestPlan | null>(null);
  const streakRef = useRef(0);
  const mistakesRef = useRef(0);
  const startedAtRef = useRef<number>(Date.now());
  const coinsRunRef = useRef(0);
  const livesRef = useRef(3);

  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  const [battleMonster, setBattleMonster] = useState(0);
  const [battleKey, setBattleKey] = useState(0);
  /** Hearts the engaged monster has when the battle opens (resume multi-heart fights). */
  const [battleMaxHp, setBattleMaxHp] = useState(1);
  const [lives, setLives] = useState(3);
  livesRef.current = lives;
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [coinsRun, setCoinsRun] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous submit latch: React state (`submitting`) lags a render, so a
  // same-tick burst (e.g. multiple game-over triggers) could double-settle.
  const submittingRef = useRef(false);
  const [failOutcome, setFailOutcome] = useState<FailOutcome | null>(null);
  const [failError, setFailError] = useState<string | null>(null);
  const termSettingsRef = useRef<{ timeLimitSeconds: number } | null>(null);
  /** Sprite slot of the monster the player is currently battling. */
  const fightingSlotRef = useRef<string>('enemy_goblin');
  // Touch devices (phones/tablets) get the on-screen D-pad; desktops with a
  // fine pointer keep keyboard-only and never see the pad.
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch(window.matchMedia?.('(pointer: coarse)').matches ?? false);
  }, []);

  // --- init: load challenges + term settings, build layout, spin up engine ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [challenges, termInfo] = await Promise.all([
          api.getChallenges(bookId, chapterId),
          api.getTermSettings(term),
          loadCustomThemes(),
        ]);
        if (cancelled) return;
        if (challenges.length === 0) {
          setError('This quest has no monsters yet. Ask your guild master to regenerate the tome.');
          return;
        }
        termSettingsRef.current = { timeLimitSeconds: termInfo.settings.timeLimitSeconds };
        // Deal the run: every monster gets DISTINCT challenges (no repeats
        // within this quest), sized by the guild's difficulty setting. Higher
        // difficulty → fewer but tougher (multi-heart) monsters, and every
        // challenge is dealt exactly once. The boss's queue is the set the
        // student will already have faced during this run.
        const seed = Math.floor(Math.random() * 0x7fffffff);
        const plan = dealQuestPlan(challenges, termInfo.settings.monsterDifficulty, seed);
        planRef.current = plan;
        const sprites = await loadSprites();
        if (cancelled) return;
        // Admin-uploaded custom frames + animation clips (best-effort).
        const animations = await getAnimations();
        if (cancelled) return;
        await loadExtraSprites(sprites, animations);
        const layout = buildLayout(chapterId, plan);
        const canvas = canvasRef.current!;
        canvas.width = BACKING_W;
        canvas.height = BACKING_H;
        startedAtRef.current = Date.now();
        // Map look: teacher's guild skin → admin config → random-by-difficulty.
        // /?theme=<id> still wins for testing (see game/themes.ts). The player's
        // wardrobe avatar rides along too.
        const urlTheme = new URLSearchParams(window.location.search).get('theme');
        const themeId = urlTheme
          ?? await api.resolveMap(chapterId, termInfo.settings.monsterDifficulty).then((r) => r.theme).catch(() => undefined);
        const resolvedTheme = resolveTheme(themeId);
        // The monster the player is actually fighting (theme rosters can swap
        // the classic goblin per map) — battles show its art, swapped too.
        const fightingSlot = (i: number) =>
          resolvedTheme.monsters?.[i % (resolvedTheme.monsters.length || 1)] ?? 'enemy_goblin';
        // The gate wakes the theme's own boss (giant lava dragon on the
        // caldera); the classic dungeon brute is the default elsewhere.
        const bossSlot = resolvedTheme.boss ?? 'boss';
        const engine = new ArcadeEngine(canvas, layout, sprites, {
          onMonsterHit: (i) => {
            setBattleMonster(i);
            setBattleKey((k) => k + 1);
            fightingSlotRef.current = fightingSlot(i);
            setBattleMaxHp(engineRef.current?.getMonsterHp(i) ?? 1);
            setPhase('battle');
          },
          onBossEncounter: () => {
            fightingSlotRef.current = bossSlot;
            setBattleKey((k) => k + 1);
            setPhase('boss');
          },
          onGameOver: () => void failQuestRef.current('out_of_lives'),
          onStateChange: (s) => {
            setLives(s.lives);
            setScore(s.score);
            // Sync synchronously: a game-over can fire in the same tick.
            const c = engineRef.current?.getCoinsCollected() ?? 0;
            coinsRunRef.current = c;
            setCoinsRun(c);
          },
        },
        themeId,
        avatar ? { ...avatar } : undefined,
        animations);
        engineRef.current = engine;
        fightingSlotRef.current = 'enemy_goblin';
        setTimeLeft(termInfo.settings.timeLimitSeconds);
        setPhase('playing');
        engine.start();
        // Dev/testing aid: inspect live game state from the console.
        (window as any).__arcade = {
          get phase() { return phaseRef.current; },
          get playerX() { return engine['px']; },
          get lives() { return engine['lives']; },
          engine,
        };
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      engineRef.current?.stop();
    };
  }, [bookId, chapterId, chapterIdx, term]);

  // --- countdown timer ---------------------------------------------------------
  const finishQuest = useCallback(
    async (finished: boolean, livesRemaining: number) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      const timeSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
      try {
        const result = await api.submitQuestComplete(chapterId, {
          mistakes: mistakesRef.current,
          timeSeconds,
          finished,
          livesRemaining,
          outOfLife: !finished && livesRemaining <= 0,
          bestStreak: streakRef.current,
          term,
          coinsGathered: coinsRunRef.current,
        });
        sfx.victory();
        onComplete(chapterId, result);
      } catch (e) {
        setError((e as Error).message);
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [chapterId, term, onComplete]
  );

  /**
   * The run FAILED (out of lives / out of time): settle it server-side, then
   * show the Game Over popup with the formula-scored result and coin penalty.
   */
  const failQuest = useCallback(
    async (reason: 'out_of_lives' | 'out_of_time') => {
      if (submittingRef.current || phaseRef.current === 'gameover') return;
      submittingRef.current = true;
      setPhase('gameover');
      setFailOutcome(null);
      setFailError(null);
      setSubmitting(true);
      const timeSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
      try {
        const result = await api.submitQuestFail(chapterId, {
          reason,
          mistakes: mistakesRef.current,
          timeSeconds,
          livesRemaining: reason === 'out_of_time' ? Math.max(0, livesRef.current) : 0,
          bestStreak: streakRef.current,
          term,
          coinsGathered: coinsRunRef.current,
        });
        sfx.defeat();
        setFailOutcome({ reason, result, coinsGathered: coinsRunRef.current });
        onFailSettled?.(chapterId, result);
      } catch (e) {
        // Popup stays up with the score we know; a RETRY attempt will re-report.
        setFailError((e as Error).message);
        submittingRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [chapterId, term, onFailSettled]
  );
  const failQuestRef = useRef(failQuest);
  failQuestRef.current = failQuest;

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'battle' && phase !== 'boss') return;
    if (timeLeft === null) return;
    if (timeLeft <= 0) {
      // Timer expired — a failed run, per the guild's term settings.
      void failQuestRef.current('out_of_time');
      return;
    }
    const t = window.setTimeout(() => setTimeLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [timeLeft, phase]);

  // pause engine whenever a dialog/battle is up
  useEffect(() => {
    engineRef.current?.setPaused(phase !== 'playing');
  }, [phase]);

  const engine = () => engineRef.current;

  const handleBattleDamage = useCallback(() => {
    engine()?.damage();
    mistakesRef.current += 1;
    streakRef.current = 0;
    setStreak(0);
  }, []);

  /** A correct answer landed: knock one heart off the engaged monster. */
  const handleMonsterHit = useCallback((monsterIndex: number) => {
    engine()?.hitMonster(monsterIndex);
  }, []);

  const handleBattleRetreat = useCallback(() => {
    if (phaseRef.current === 'boss') {
      engine()?.retreatFromBoss(); // re-arm the gate — the boss awaits again
    } else {
      engine()?.retreatFromBattle();
    }
    setPhase('playing');
  }, []);

  const handleBattleVictory = useCallback(
    (monsterIndex: number | null) => {
      if (monsterIndex === null) {
        // boss victory → quest complete
        void finishQuest(true, Math.max(0, livesRef.current));
        return;
      }
      engine()?.monsterDefeated(monsterIndex);
      streakRef.current += 1;
      setStreak(streakRef.current);
      setPhase('playing');
    },
    [finishQuest]
  );

  function retryLevel() {
    engine()?.resetLevel();
    streakRef.current = 0;
    mistakesRef.current = 0;
    submittingRef.current = false;
    setStreak(0);
    setCoinsRun(0);
    coinsRunRef.current = 0;
    startedAtRef.current = Date.now();
    setFailOutcome(null);
    setFailError(null);
    setTimeLeft(termSettingsRef.current?.timeLimitSeconds ?? null);
    setPhase('playing');
  }

  if (error) {
    return (
      <div className="dialog-box" style={{ maxWidth: 560, margin: '0 auto' }}>
        <p className="error-text">{error}</p>
        <button className="pixel-btn" onClick={onExit}>BACK TO MAP</button>
      </div>
    );
  }

  const mm = timeLeft === null ? '--' : String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = timeLeft === null ? '--' : String(timeLeft % 60).padStart(2, '0');
  const timeCritical = timeLeft !== null && timeLeft <= 30;

  return (
    <div className="level-screen" style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="hud" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span className="label">QUEST {chapterIdx + 1}</span>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {Array.from({ length: 3 }, (_, i) => (
            <img
              key={i}
              src={spriteDataUrl(i < lives ? 'heart' : 'heart_empty')}
              alt=""
              style={{ width: 14, height: 11, marginRight: '0.15rem', imageRendering: 'pixelated' }}
            />
          ))}
        </span>
        <span>
          <span className="label">SCORE:</span> {score}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <img src={spriteDataUrl('coin')} alt="" style={{ width: 12, height: 12 }} />
          <span className="label">{coinsRun}</span>
        </span>
        <span>
          <span className="label">STREAK:</span> {streak}
        </span>
        <span className={timeCritical ? 'blink' : ''} style={{ color: timeCritical ? 'var(--d-rose)' : 'var(--d-gold)' }}>
          ⏳ {mm}:{ss}
        </span>
        <button
          className="pixel-btn pixel-btn--ghost"
          onClick={() => sfx.toggle()}
          title="Toggle sound"
          style={{ fontSize: '0.8rem' }}
        >
          {sfx.isMuted() ? '🔇' : '🔊'}
        </button>
        <button className="pixel-btn pixel-btn--ghost" onClick={onExit} style={{ fontSize: '0.8rem' }}>
          FLEE QUEST
        </button>
      </div>

      {/* Wrapper is the overlay anchor: touch controls float over the canvas
          instead of stacking below it and pushing the game down the page. */}
      <div className="game-canvas-wrap">
        <canvas id="game-canvas" ref={canvasRef} />
        {isTouch && phase === 'playing' && <TouchControls engine={engineRef.current} />}
      </div>

      <LandscapeHint active={phase === 'playing'} />

      {phase === 'battle' && planRef.current && (
        <div className="modal-overlay">
          <BattleScreen
            key={`battle-${battleKey}`}
            queue={planRef.current.monsterQueues[battleMonster] ?? []}
            maxHp={Math.max(1, battleMaxHp)}
            lives={lives}
            monsterSlot={fightingSlotRef.current}
            onDamage={handleBattleDamage}
            onHit={() => handleMonsterHit(battleMonster)}
            onRetreat={handleBattleRetreat}
            onVictory={() => handleBattleVictory(battleMonster)}
          />
        </div>
      )}

      {phase === 'boss' && planRef.current && (
        <div className="modal-overlay">
          <BattleScreen
            key={`boss-${battleKey}`}
            queue={planRef.current.bossQueue}
            maxHp={planRef.current.bossQueue.length}
            lives={lives}
            boss
            monsterSlot={fightingSlotRef.current}
            onDamage={handleBattleDamage}
            onRetreat={handleBattleRetreat}
            onVictory={() => handleBattleVictory(null)}
          />
        </div>
      )}

      {phase === 'gameover' && (
        <div className="modal-overlay">
          <div className="gameover-panel">
            <p className="gameover-title">☠ GAME OVER ☠</p>
            <p className="gameover-sub">
              {failOutcome?.reason === 'out_of_time'
                ? 'The sands ran out — your time is spent.'
                : failOutcome
                  ? 'Your last heart was shattered…'
                  : 'Your quest has ended in defeat…'}
            </p>

            {!failOutcome ? (
              <p className="gameover-note">
                {failError ?? 'Recording your defeat…'}
              </p>
            ) : (
              <>
                <div className="gameover-stats">
                  <div className="gameover-row">
                    <span>Quest score</span>
                    <strong>{failOutcome.result.rawScore} pts</strong>
                  </div>
                  <div className="gameover-row">
                    <span>Coins gathered</span>
                    <strong>{failOutcome.coinsGathered} 🪙</strong>
                  </div>
                  <div className="gameover-row gameover-row--penalty">
                    <span>Penalty</span>
                    <strong>−{failOutcome.result.coinsPenalty ?? 0} 🪙</strong>
                  </div>
                  <div className="gameover-row gameover-row--net">
                    <span>Banked from this run</span>
                    <strong>+{failOutcome.result.coinsAwarded} 🪙</strong>
                  </div>
                </div>
                <p className="gameover-note">
                  Only coins gathered this run were at stake — your treasury is safe.
                </p>
              </>
            )}

            <div className="gameover-actions">
              <button className="pixel-btn" onClick={retryLevel} disabled={submitting}>
                ⚔ RETRY QUEST
              </button>
              <button className="pixel-btn pixel-btn--ghost" onClick={onExit} disabled={submitting}>
                🗺 KINGDOM MAP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
