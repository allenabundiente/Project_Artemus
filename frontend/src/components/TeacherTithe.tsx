/**
 * Teacher's tithe ledger: each guild student's coin earnings this term and the
 * 10% cut collected from their completed quests, plus totals. Rendered in the
 * teacher hall — quiet students (no quests) still appear, at zero.
 */
import { useEffect, useState } from 'react';
import * as api from '../api';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';
import type { AvatarPrefs } from '../types';

/** Matches the backend's academic terms (services/termSettings.ts). */
const TERMS = ['prelims', 'midterms', 'semis', 'finals'] as const;

const COIN_ICON = '🪙';

export default function TeacherTithe() {
  const [term, setTerm] = useState('prelims');
  const [ledger, setLedger] = useState<api.TitheLedger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setLedger(null);
    api.getTitheLedger(term)
      .then((r) => { if (alive) setLedger(r); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [term]);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="pixel-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <p className="pixel-font" style={{ fontSize: '0.85rem', margin: 0 }}>💰 TITHE LEDGER</p>
          <label className="term-font" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            TERM
            <select
              className="pixel-select"
              style={{ fontSize: '0.7rem' }}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            >
              {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <p className="term-font" style={{ margin: '0.3rem 0 0.7rem', color: 'var(--d-stone-light)' }}>
          You collect 10% of every coin your students earn on completed quests — per term, tallied live.
        </p>

        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        {ledger === null && !error && <p className="status-text" style={{ margin: 0 }}>Counting the coffers…</p>}
        {ledger !== null && ledger.entries.length === 0 && (
          <p className="status-text" style={{ margin: 0 }}>No students yet — share the guild code!</p>
        )}

        {ledger !== null && ledger.entries.length > 0 && (
          <>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {ledger.entries.map((e) => (
                <li
                  key={e.userId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.4rem 0.2rem', borderTop: '1px solid var(--d-stone)',
                  }}
                >
                  <AvatarSprite avatar={(e.avatar as unknown as AvatarPrefs) ?? DEFAULT_AVATAR} size={24} title={`${e.name}'s heraldic avatar`} />
                  <span className="term-font" style={{ fontSize: '0.8rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>
                    {e.name}
                  </span>
                  <span className="term-font" style={{ fontSize: '0.75rem', color: 'var(--d-stone-light)' }} title="Completed quests that paid the tithe">
                    ⚔ {e.quests}
                  </span>
                  <span className="term-font" style={{ fontSize: '0.75rem' }} title="Coins the student earned this term">
                    {COIN_ICON} {e.earned}
                  </span>
                  <span className="term-font" style={{ fontSize: '0.8rem', color: 'var(--d-gold)', minWidth: '3.5ch', textAlign: 'right' }} title="Your 10% cut from this student">
                    +{e.tithe}
                  </span>
                </li>
              ))}
            </ul>
            <div
              style={{
                display: 'flex', justifyContent: 'flex-end', gap: '1.2rem', alignItems: 'baseline',
                borderTop: '2px solid var(--d-gold)', marginTop: '0.5rem', paddingTop: '0.45rem',
              }}
            >
              <span className="term-font" style={{ fontSize: '0.7rem', color: 'var(--d-stone-light)' }}>
                ⚔ {ledger.totals.quests} quests paid
              </span>
              <span className="term-font" style={{ fontSize: '0.75rem', color: 'var(--d-stone-light)' }}>
                students earned {COIN_ICON} {ledger.totals.earned}
              </span>
              <span className="pixel-font" style={{ fontSize: '0.85rem', color: 'var(--d-gold)', margin: 0 }}>
                your cut: {COIN_ICON} {ledger.totals.tithe}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
