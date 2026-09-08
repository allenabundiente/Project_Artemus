import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoreResultResponse, Term } from '../types';
import * as api from '../api';
import { ArcadeEngine, buildLayout } from '../game/engine';
import { loadSprites, spriteDataUrl } from '../game/sprites';
import { sfx } from '../game/sfx';
import BattleScreen from './BattleScreen';

interface Props {
  bookId: string;
  chapterId: string;
  chapterIdx: number;
  term: Term;
  onExit: () => void;
  onComplete: (chapterId: string, result: ScoreResultResponse) => void;
}

type Phase = 'loading' | 'playing' | 'battle' | 'boss' | 'won' | 'gameover';

export default function LevelScreen({ bookId, chapterId, chapterIdx, term, onExit, onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ArcadeEngine | null>(null);
  const challengesRef = useRef<import('../types').Challenge[]>([]);
  const streakRef = useRef(0);
  const mistakesRef = useRef(0);
  const startedAtRef = useRef<number>(Date.now());

  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  const [battleMonster, setBattleMonster] = useState(0);
  const [battleKey, setBattleKey] = useState(0);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const termSettingsRef = useRef<{ timeLimitSeconds: number } | null>(null);

  // --- init: load challenges + term settings, build layout, spin up engine ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [challenges, termInfo] = await Promise.all([
          api.getChallenges(bookId, chapterId),
          api.getTermSettings(term),
        ]);
        if (cancelled) return;
        if (challenges.length === 0) {
          setError('This quest has no monsters yet. Ask your guild master to regenerate the tome.');
          return;
        }
        termSettingsRef.current = { timeLimitSeconds: termInfo.settings.timeLimitSeconds };
        challengesRef.current = challenges;
        const sprites = await loadSprites();
        if (cancelled) return;
        const layout = buildLayout(chapterId, challenges);
        const canvas = canvasRef.current!;
        canvas.width = 320;
        canvas.height = 180;
        startedAtRef.current = Date.now();
        const engine = new ArcadeEngine(canvas, layout, sprites, {
          onMonsterHit: (i) => {
            setBattleMonster(i);
            setBattleKey((k) => k + 1);
            setPhase('battle');
          },
          onBossEncounter: () => {
            setBattleKey((k) => k + 1);
            setPhase('boss');
          },
          onGameOver: () => setPhase('gameover'),
          onStateChange: (s) => {
            setLives(s.lives);
            setScore(s.score);
          },
        });
        engineRef.current = engine;
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
      if (submitting) return;
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
        });
        sfx.victory();
        onComplete(chapterId, result);
      } catch (e) {
        setError((e as Error).message);
        setSubmitting(false);
      }
    },
    [chapterId, term, onComplete, submitting]
  );

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'battle' && phase !== 'boss') return;
    if (timeLeft === null) return;
    if (timeLeft <= 0) {
      // Timer expired — record an incomplete run.
      void finishQuest(false, Math.max(0, lives));
      return;
    }
    const t = window.setTimeout(() => setTimeLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [timeLeft, phase, finishQuest, lives]);

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

  const handleBattleRetreat = useCallback(() => {
    engine()?.retreatFromBattle();
    setPhase('playing');
  }, []);

  const handleBattleVictory = useCallback(
    (monsterIndex: number | null) => {
      if (monsterIndex === null) {
        // boss victory → quest complete
        void finishQuest(true, Math.max(0, lives));
        return;
      }
      engine()?.monsterDefeated(monsterIndex);
      streakRef.current += 1;
      setStreak(streakRef.current);
      setPhase('playing');
    },
    [finishQuest, lives]
  );

  function retryLevel() {
    engine()?.resetLevel();
    streakRef.current = 0;
    mistakesRef.current = 0;
    setStreak(0);
    startedAtRef.current = Date.now();
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
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
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

      <canvas id="game-canvas" ref={canvasRef} />

      {phase === 'battle' && (
        <div style={{ marginTop: '1rem' }}>
          <BattleScreen
            key={`battle-${battleKey}`}
            challenges={challengesRef.current}
            leadChallenge={challengesRef.current[battleMonster]}
            lives={lives}
            onDamage={handleBattleDamage}
            onRetreat={handleBattleRetreat}
            onVictory={() => handleBattleVictory(battleMonster)}
          />
        </div>
      )}

      {phase === 'boss' && (
        <div style={{ marginTop: '1rem' }}>
          <BattleScreen
            key={`boss-${battleKey}`}
            challenges={challengesRef.current}
            lives={lives}
            boss
            onDamage={handleBattleDamage}
            onRetreat={handleBattleRetreat}
            onVictory={() => handleBattleVictory(null)}
          />
        </div>
      )}

      {phase === 'gameover' && (
        <div className="dialog-box" style={{ maxWidth: 520, margin: '0 auto' }}>
          <p className="pixel-font" style={{ color: 'var(--d-red)', fontSize: '0.8rem' }}>DEFEATED</p>
          <p className="term-font">Out of hearts! The dungeon remembers — respawn and try again, or withdraw to record an incomplete quest.</p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button className="pixel-btn" onClick={() => void finishQuest(false, 0)}>RECORD & WITHDRAW</button>
            <button className="pixel-btn pixel-btn--primary" onClick={retryLevel}>CONTINUE</button>
          </div>
        </div>
      )}
    </div>
  );
}
