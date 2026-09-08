import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { Term, TermSettings } from '../types';

interface Props {
  onSaved: () => void;
}

const TERMS: Term[] = ['prelims', 'midterms', 'semis', 'finals'];
const TERM_LABEL: Record<Term, string> = {
  prelims: 'PRELIMS',
  midterms: 'MIDTERMS',
  semis: 'SEMIS',
  finals: 'FINALS',
};

export default function GuildSettings({ onSaved }: Props) {
  const [settings, setSettings] = useState<Record<string, TermSettings>>({});
  const [activeTerm, setActiveTerm] = useState<Term>('prelims');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getGuildSettings();
        setSettings(res.termSettings);
        setDirty(false);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const current = settings[activeTerm];

  const preview = useMemo(() => {
    if (!current) return null;
    const { difficultyMix, pointsMultiplier, timeLimitSeconds, monsterDifficulty } = current;
    const total = difficultyMix.easy + difficultyMix.medium + difficultyMix.hard;
    const pct = (n: number) => Math.round((n / total) * 100);
    return {
      timeMin: Math.round(timeLimitSeconds / 60),
      mult: pointsMultiplier,
      mix: `${pct(difficultyMix.easy)}% easy / ${pct(difficultyMix.medium)}% medium / ${pct(difficultyMix.hard)}% hard`,
      monster: monsterDifficulty.toUpperCase(),
    };
  }, [current]);

  function update(patch: Partial<TermSettings>) {
    if (!current) return;
    setSettings((s) => ({ ...s, [activeTerm]: { ...s[activeTerm], ...patch } }));
    setDirty(true);
  }

  function updateMix(patch: Partial<TermSettings['difficultyMix']>) {
    if (!current) return;
    update({ difficultyMix: { ...current.difficultyMix, ...patch } });
  }

  function updateWeight(key: keyof TermSettings['scoreWeights'], value: number) {
    if (!current) return;
    update({ scoreWeights: { ...current.scoreWeights, [key]: value } });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveGuildSettings(settings);
      setSettings(res.termSettings);
      setDirty(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!current) return <p className="status-text" style={{ maxWidth: 640, margin: '0 auto' }}>Loading settings…</p>;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="pixel-panel">
        <p className="pixel-font" style={{ fontSize: '0.85rem', marginTop: 0 }}>⚙ GUILD MASTER SETTINGS</p>

        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {TERMS.map((t) => (
            <button
              key={t}
              className={`pixel-btn ${t === activeTerm ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
              style={{ fontSize: '0.6rem' }}
              onClick={() => setActiveTerm(t)}
            >
              {TERM_LABEL[t]}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gap: '0.9rem' }}>
          <label style={{ display: 'block' }}>
            <span className="pixel-font" style={{ fontSize: '0.55rem', display: 'block', marginBottom: '0.3rem' }}>
              ⏳ QUEST TIME LIMIT (MINUTES)
            </span>
            <input
              className="pixel-input"
              type="number"
              min={1}
              max={120}
              value={Math.round(current.timeLimitSeconds / 60)}
              onChange={(e) => update({ timeLimitSeconds: Math.max(60, Number(e.target.value) * 60 || 60) })}
            />
          </label>

          <label style={{ display: 'block' }}>
            <span className="pixel-font" style={{ fontSize: '0.55rem', display: 'block', marginBottom: '0.3rem' }}>
              ✨ POINTS WORTH (MULTIPLIER)
            </span>
            <input
              className="pixel-input"
              type="number"
              min={0.25}
              max={10}
              step={0.25}
              value={current.pointsMultiplier}
              onChange={(e) => update({ pointsMultiplier: Math.max(0.25, Number(e.target.value) || 1) })}
            />
          </label>

          <div>
            <span className="pixel-font" style={{ fontSize: '0.55rem', display: 'block', marginBottom: '0.3rem' }}>
              👹 MONSTER DIFFICULTY (GENERATION)
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  className={`pixel-btn ${current.monsterDifficulty === d ? 'pixel-btn--primary' : 'pixel-btn--ghost'}`}
                  style={{ fontSize: '0.6rem', flex: 1 }}
                  onClick={() => update({ monsterDifficulty: d })}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="pixel-font" style={{ fontSize: '0.55rem', display: 'block', marginBottom: '0.3rem' }}>
              📊 QUIZ DIFFICULTY MIX (EASY / MEDIUM / HARD %)
            </span>
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                <span className="term-font" style={{ width: 70, fontSize: '1.05rem' }}>{d}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={current.difficultyMix[d]}
                  onChange={(e) => updateMix({ [d]: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: 'var(--d-gold)' }}
                />
                <span className="term-font" style={{ width: 40, fontSize: '1.05rem', textAlign: 'right' }}>{current.difficultyMix[d]}%</span>
              </div>
            ))}
          </div>

          <div>
            <span className="pixel-font" style={{ fontSize: '0.55rem', display: 'block', marginBottom: '0.3rem' }}>
              ⚖ SCORE WEIGHTS
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {(
                [
                  ['basePoints', 'Base points'],
                  ['mistakePenalty', 'Mistake penalty'],
                  ['timePenalty', 'Over-par penalty'],
                  ['lifeBonus', 'Life bonus'],
                  ['incompletePenalty', 'Incomplete penalty'],
                  ['outOfLifePenalty', 'Out-of-life penalty'],
                ] as [keyof TermSettings['scoreWeights'], string][]
              ).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="term-font" style={{ flex: 1, fontSize: '1rem' }}>{label}</span>
                  <input
                    className="pixel-input"
                    type="number"
                    min={0}
                    value={current.scoreWeights[key]}
                    onChange={(e) => updateWeight(key, Math.max(0, Number(e.target.value) || 0))}
                    style={{ width: 80 }}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        {preview && (
          <div className="pixel-panel--parchment pixel-panel" style={{ marginTop: '1rem' }}>
            <p className="pixel-font" style={{ fontSize: '0.55rem', marginTop: 0, marginBottom: '0.4rem' }}>
              LIVE PREVIEW — {TERM_LABEL[activeTerm]}
            </p>
            <p className="term-font" style={{ margin: '0.15rem 0', fontSize: '1.05rem' }}>⏳ {preview.timeMin} min per quest</p>
            <p className="term-font" style={{ margin: '0.15rem 0', fontSize: '1.05rem' }}>✨ quest points ×{preview.mult}</p>
            <p className="term-font" style={{ margin: '0.15rem 0', fontSize: '1.05rem' }}>👹 monsters: {preview.monster}</p>
            <p className="term-font" style={{ margin: '0.15rem 0', fontSize: '1.05rem' }}>📊 quiz mix: {preview.mix}</p>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.9rem' }}>
          <button className="pixel-btn pixel-btn--primary" onClick={save} disabled={busy || !dirty}>
            {busy ? 'SAVING…' : dirty ? 'SAVE SETTINGS' : 'SAVED'}
          </button>
        </div>
      </div>
    </div>
  );
}
