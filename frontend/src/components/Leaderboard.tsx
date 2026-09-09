import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { LeaderboardResponse, Term } from '../types';
import RankBadge from './RankBadge';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';

interface Props {
  userRole: 'teacher' | 'student';
  userGuildId: string | null;
  currentUserId: string;
}

const TERMS: (Term | 'all')[] = ['all', 'prelims', 'midterms', 'semis', 'finals'];

export default function Leaderboard({ userRole, userGuildId, currentUserId }: Props) {
  const [scope, setScope] = useState<'guild' | 'global'>(userGuildId || userRole === 'teacher' ? 'guild' : 'global');
  const [term, setTerm] = useState<Term | 'all'>('all');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await api.getLeaderboard(term === 'all' ? null : term, scope));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scope, term]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guildUnavailable = scope === 'guild' && !userGuildId && userRole === 'student';

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="pixel-panel">
        <p className="pixel-font" style={{ fontSize: '0.85rem', marginTop: 0 }}>⚔ HALL OF HEROES</p>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          {(userRole === 'teacher' || userGuildId) && (
            <button
              className={`pixel-btn ${scope === 'guild' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
              style={{ fontSize: '0.65rem' }}
              onClick={() => setScope('guild')}
            >
              GUILD
            </button>
          )}
          <button
            className={`pixel-btn ${scope === 'global' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
            style={{ fontSize: '0.65rem' }}
            onClick={() => setScope('global')}
          >
            ALL SOLO ADVENTURERS
          </button>
          <select
            className="pixel-select"
            value={term}
            onChange={(e) => setTerm(e.target.value as Term | 'all')}
            style={{ marginLeft: 'auto' }}
          >
            {TERMS.map((t) => (
              <option key={t} value={t}>{t === 'all' ? 'All-Time' : t.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {guildUnavailable && (
          <p className="status-text">Join a guild to see its leaderboard — or view the solo board.</p>
        )}
        {error && <p className="error-text">{error}</p>}

        {data && !guildUnavailable && (
          <>
            <p className="term-font" style={{ margin: '0 0 0.5rem', color: 'var(--d-stone-light)' }}>
              {data.scope === 'guild' ? 'Guild standings' : 'Solo adventurers'} · {data.term ? `${data.term} term` : 'all time'} · cumulative score
            </p>
            {data.entries.length === 0 && <p className="status-text">No adventurers recorded yet.</p>}
            <div>
              {data.entries.map((e, i) => (
                <div key={e.userId} className={`leaderboard-row ${e.userId === currentUserId ? 'leaderboard-row--me' : ''}`}>
                  <span className="leaderboard-pos">#{i + 1}</span>
                  <AvatarSprite avatar={e.avatar ?? DEFAULT_AVATAR} size={26} animate={e.userId === currentUserId} title={`${e.name}'s heraldic avatar`} />
                  <RankBadge rank={e.rank} size={22} />
                  <span className="term-font" style={{ fontSize: '1.15rem', flex: 1 }}>{e.name}</span>
                  <span className="term-font" style={{ fontSize: '1.05rem', color: 'var(--d-stone-light)' }}>
                    {e.questCount} quest{e.questCount === 1 ? '' : 's'}
                  </span>
                  <span className="pixel-font" style={{ fontSize: '0.7rem', color: 'var(--d-gold)' }}>{e.termScore}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
