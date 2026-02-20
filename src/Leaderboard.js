'use client';

import { useEffect, useState } from 'react';

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  function formatTime(value) {
    if (!value) return '--:--:--';
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  useEffect(() => {
    let isActive = true;
    let intervalId;

    async function loadLeaderboard({ showLoading = false, showRefreshing = false } = {}) {
      if (showLoading) setIsLoading(true);
      if (showRefreshing) setIsRefreshing(true);

      try {
        const response = await fetch('/api/leaderboard?limit=10', {
          cache: 'no-store',
        });
        const payload = await response.json();

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.message || 'Failed to load leaderboard.');
        }

        if (isActive) {
          setRows(payload.leaderboard || []);
          setError('');
          setLastUpdatedAt(Date.now());
        }
      } catch (fetchError) {
        if (isActive) {
          setError(fetchError.message || 'Unable to load leaderboard.');
        }
      } finally {
        if (isActive && showLoading) setIsLoading(false);
        if (isActive && showRefreshing) setIsRefreshing(false);
      }
    }

    loadLeaderboard({ showLoading: true });
    intervalId = setInterval(() => loadLeaderboard(), 10000);

    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, []);

  return (
    <section className="leaderboard-panel">
      <div className="leaderboard-head">
        <h2>Leaderboard</h2>
        <div className="leaderboard-refresh">
          <span>Wallet USD</span>
          <button
            type="button"
            className="leaderboard-refresh-btn"
            onClick={() => {
              if (isRefreshing) return;
              setIsRefreshing(true);
              fetch('/api/leaderboard?limit=10', { cache: 'no-store' })
                .then((response) => response.json().then((payload) => ({ response, payload })))
                .then(({ response, payload }) => {
                  if (!response.ok || !payload?.ok) {
                    throw new Error(payload?.message || 'Failed to load leaderboard.');
                  }
                  setRows(payload.leaderboard || []);
                  setError('');
                  setLastUpdatedAt(Date.now());
                })
                .catch((fetchError) => {
                  setError(fetchError.message || 'Unable to load leaderboard.');
                })
                .finally(() => setIsRefreshing(false));
            }}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className="leaderboard-updated">Updated {formatTime(lastUpdatedAt)}</p>

      {isLoading && <p className="leaderboard-note">Loading leaderboard...</p>}
      {!isLoading && error && <p className="leaderboard-note error">{error}</p>}
      {!isLoading && !error && rows.length === 0 && (
        <p className="leaderboard-note">No ranked users yet.</p>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="leaderboard-list">
          {rows.map((entry) => (
            <article key={entry.id} className="leaderboard-row">
              <span className="leaderboard-rank">#{entry.rank}</span>
              <div className="leaderboard-user">
                <strong>{entry.name}</strong>
                {/* <small>{entry.emailMasked}</small> */}
              </div>
              <strong className="leaderboard-balance">{formatCurrency(entry.usdBalance)}</strong>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
