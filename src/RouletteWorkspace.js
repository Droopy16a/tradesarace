'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import { clearStoredUser } from './lib/auth-client';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const WALLET_STORAGE_KEY = 'tradesarace_wallet_v1';
const POSITIONS_STORAGE_KEY = 'tradesarace_positions_v1';
const DEFAULT_WALLET = {
  usdBalance: 20000,
  btcBalance: 0.35,
  bonus: 185,
};

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL_NUMBERS = [
  32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26, 0,
];
const SPIN_DURATION_MS = 9000;
const WHEEL_SIZE = 100;
const OUTER_R = 48;
const INNER_R = 33.8;
const SEGMENT_ANGLE = 360 / WHEEL_NUMBERS.length;

function normalizeWallet(wallet) {
  if (
    wallet &&
    typeof wallet.usdBalance === 'number' &&
    typeof wallet.btcBalance === 'number' &&
    typeof wallet.bonus === 'number'
  ) {
    return wallet;
  }
  return DEFAULT_WALLET;
}

function normalizePositions(positions) {
  if (!Array.isArray(positions)) return [];
  return positions;
}

function loadGuestState() {
  try {
    const walletRaw = localStorage.getItem(WALLET_STORAGE_KEY);
    const positionsRaw = localStorage.getItem(POSITIONS_STORAGE_KEY);
    const wallet = normalizeWallet(walletRaw ? JSON.parse(walletRaw) : null);
    const positions = normalizePositions(positionsRaw ? JSON.parse(positionsRaw) : []);
    return { wallet, positions };
  } catch {
    return { wallet: DEFAULT_WALLET, positions: [] };
  }
}

function getRouletteColor(value) {
  if (value === 0) return 'green';
  return RED_NUMBERS.has(value) ? 'red' : 'black';
}

function polarToCartesian(cx, cy, radius, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

function buildSegmentPath(startDeg, endDeg, outerRadius, innerRadius) {
  const center = WHEEL_SIZE / 2;
  const p1 = polarToCartesian(center, center, outerRadius, startDeg);
  const p2 = polarToCartesian(center, center, outerRadius, endDeg);
  const p3 = polarToCartesian(center, center, innerRadius, endDeg);
  const p4 = polarToCartesian(center, center, innerRadius, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ');
}

function evaluateBet({ type, amount, number }, rolledNumber, rolledColor) {
  if (type === 'straight') {
    const hit = rolledNumber === number;
    return {
      win: hit,
      delta: hit ? amount * 35 : -amount,
      label: `Number ${number}`,
    };
  }

  if (type === 'red' || type === 'black') {
    const hit = rolledColor === type;
    return {
      win: hit,
      delta: hit ? amount : -amount,
      label: type === 'red' ? 'Red' : 'Black',
    };
  }

  if (type === 'odd' || type === 'even') {
    const hit = rolledNumber !== 0 && (rolledNumber % 2 === 0 ? 'even' : 'odd') === type;
    return {
      win: hit,
      delta: hit ? amount : -amount,
      label: type === 'odd' ? 'Odd' : 'Even',
    };
  }

  return {
    win: false,
    delta: -amount,
    label: 'Unknown',
  };
}

export default function RouletteWorkspace() {
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [positions, setPositions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isStateReady, setIsStateReady] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [rotationDeg, setRotationDeg] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [maskText, setMaskText] = useState('Place your bets');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const [betType, setBetType] = useState('red');
  const [betAmount, setBetAmount] = useState('25');
  const [straightNumber, setStraightNumber] = useState('17');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastSpinAt, setLastSpinAt] = useState(null);

  const spinTimeoutRef = useRef(null);
  const profileWrapRef = useRef(null);

  useEffect(() => {
    let isActive = true;

    async function bootstrapState() {
      let authenticatedUser = null;
      try {
        const meResponse = await fetch('/api/auth/me', { cache: 'no-store' });
        const mePayload = await meResponse.json();
        if (meResponse.ok && mePayload?.ok) {
          authenticatedUser = mePayload.user;
        }
      } catch {}

      if (!isActive) return;
      setCurrentUser(authenticatedUser);

      if (!authenticatedUser) {
        const guestState = loadGuestState();
        if (!isActive) return;
        setWallet(guestState.wallet);
        setPositions(guestState.positions);
      } else {
        try {
          const response = await fetch('/api/user-state', { cache: 'no-store' });
          const payload = await response.json();
          if (isActive && response.ok && payload?.ok) {
            setWallet(normalizeWallet(payload.wallet));
            setPositions(normalizePositions(payload.positions));
          }
        } catch {}
      }

      if (isActive) {
        setIsStateReady(true);
        setHasHydrated(true);
      }
    }

    bootstrapState();
    return () => {
      isActive = false;
      if (spinTimeoutRef.current) {
        window.clearTimeout(spinTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated || !isStateReady || currentUser) return;
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  }, [wallet, positions, currentUser, hasHydrated, isStateReady]);

  useEffect(() => {
    if (!showProfileMenu) return undefined;

    function handlePointerDown(event) {
      const nextTarget = event.target;
      if (!(nextTarget instanceof Node)) return;
      if (profileWrapRef.current?.contains(nextTarget)) return;
      setShowProfileMenu(false);
    }

    function handleEscape(event) {
      if (event.key !== 'Escape') return;
      setShowProfileMenu(false);
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showProfileMenu]);

  const availableBalance = useMemo(() => {
    const marginInUse = positions.reduce((total, pos) => (
      total + ((Number(pos.amount) || 0) * (Number(pos.executionPrice) || 0) / (Number(pos.leverage) || 1))
    ), 0);
    return wallet.usdBalance - marginInUse;
  }, [wallet.usdBalance, positions]);

  const wheelSegments = useMemo(() => {
    return WHEEL_NUMBERS.map((num, index) => {
      const start = -90 + index * SEGMENT_ANGLE;
      const end = start + SEGMENT_ANGLE;
      const mid = start + SEGMENT_ANGLE / 2;
      const color = getRouletteColor(num);
      const path = buildSegmentPath(start, end, OUTER_R, INNER_R);
      const textPos = polarToCartesian(WHEEL_SIZE / 2, WHEEL_SIZE / 2, 40.6, mid);
      return { num, color, path, mid, textPos };
    });
  }, []);

  const parsedBetAmount = Number(betAmount);

  const estimatedMaxWin = useMemo(() => {
    if (!Number.isFinite(parsedBetAmount) || parsedBetAmount <= 0) return 0;
    return betType === 'straight' ? parsedBetAmount * 35 : parsedBetAmount;
  }, [betType, parsedBetAmount]);
  const hasValidStraightNumber = Number.isInteger(Number(straightNumber))
    && Number(straightNumber) >= 0
    && Number(straightNumber) <= 36;
  const canSpin = (
    !isSpinning
    && Number.isFinite(parsedBetAmount)
    && parsedBetAmount > 0
    && parsedBetAmount <= availableBalance
    && (betType !== 'straight' || hasValidStraightNumber)
  );

  async function handleSettle(delta, reason) {
    setError('');
    if (!Number.isFinite(delta)) return false;
    if (delta < 0 && Math.abs(delta) > availableBalance) {
      setError('Insufficient available balance.');
      return false;
    }

    if (!currentUser) {
      setWallet((current) => ({ ...current, usdBalance: current.usdBalance + delta }));
      setMessage(reason);
      setTimeout(() => setMessage(''), 5000);
      return true;
    }

    try {
      const response = await fetch('/api/user-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'walletAdjust',
          amount: delta,
          reason,
        }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setError(payload?.message || 'Unable to settle roulette round.');
        return false;
      }

      setWallet(normalizeWallet(payload.wallet));
      setPositions(normalizePositions(payload.positions));
      setMessage(payload.message || reason);
      setTimeout(() => setMessage(''), 5000);
      return true;
    } catch {
      setError('Network error while settling round.');
      return false;
    }
  }

  function validateBet() {
    if (!Number.isFinite(parsedBetAmount) || parsedBetAmount <= 0) {
      return 'Enter a valid bet amount.';
    }
    if (parsedBetAmount > availableBalance) {
      return 'Bet exceeds available balance.';
    }

    if (betType === 'straight') {
      const n = Number(straightNumber);
      if (!Number.isInteger(n) || n < 0 || n > 36) {
        return 'Straight bet number must be from 0 to 36.';
      }
    }

    return null;
  }

  async function handleSpin() {
    if (isSpinning) return;
    setMessage('');
    setError('');

    const validationError = validateBet();
    if (validationError) {
      setError(validationError);
      return;
    }

    const betPayload = {
      type: betType,
      amount: parsedBetAmount,
      number: Number(straightNumber),
    };

    const index = Math.floor(Math.random() * WHEEL_NUMBERS.length);
    const number = WHEEL_NUMBERS[index];
    const color = getRouletteColor(number);
    const targetNormalized = 360 - ((index + 0.5) * SEGMENT_ANGLE);

    setIsSpinning(true);
    setResult(null);
    setMaskText('No more bets');

    setRotationDeg((current) => {
      const normalized = ((current % 360) + 360) % 360;
      const delta = (targetNormalized - normalized + 360) % 360;
      return current + 8 * 360 + delta;
    });

    spinTimeoutRef.current = window.setTimeout(async () => {
      setMaskText('Place your bets');
      setResult({ number, color });
      setHistory((current) => [{ number, color }, ...current].slice(0, 8));
      setLastSpinAt(Date.now());

      const outcome = evaluateBet(betPayload, number, color);
      const reason = outcome.win
        ? `${outcome.label} wins. +${outcome.delta.toFixed(2)} USD.`
        : `${outcome.label} lost. -${Math.abs(outcome.delta).toFixed(2)} USD.`;

      await handleSettle(outcome.delta, reason);
      setIsSpinning(false);
      spinTimeoutRef.current = null;
    }, SPIN_DURATION_MS);
  }

  function handleReset() {
    if (isSpinning) return;
    setResult(null);
    setHistory([]);
    setMessage('');
    setError('');
    setMaskText('Place your bets');
  }

  function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearStoredUser();
    const guestState = loadGuestState();
    setWallet(guestState.wallet);
    setPositions(guestState.positions);
    setCurrentUser(null);
    setShowProfileMenu(false);
  }

  const avatarSeed = encodeURIComponent(currentUser?.name || currentUser?.email || 'User');
  const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${avatarSeed}`;

  function formatCurrency(value) {
    return `$${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatTime(value) {
    if (!value) return '--:--:--';
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  if (!isStateReady) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Box sx={{ px: { xs: 0.5, sm: 1 }, pt: { xs: 0.5, sm: 1 } }}>
          <div className="workspace-loading" role="status" aria-live="polite">
            <span className="workspace-loader" aria-hidden="true" />
            <p>Loading roulette workspace...</p>
          </div>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ px: { xs: 0.5, sm: 1 }, pt: { xs: 0.5, sm: 1 } }}>
        <div className="workspace-topbar">
          <div className="auth-buttons">
            <Link href="/" className="auth-link login-btn">Back To Markets</Link>
          </div>
          {!currentUser ? (
            <div className="auth-buttons">
              <Link href="/login" className="auth-link login-btn">Login</Link>
              <Link href="/register" className="auth-link register-btn">Register</Link>
            </div>
          ) : (
            <div className="workspace-topbar-right">
              <div className="profile-wrap" ref={profileWrapRef}>
                <button
                  type="button"
                  className="profile-trigger"
                  onClick={() => setShowProfileMenu((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={showProfileMenu}
                  aria-label="Open profile menu"
                >
                  <img
                    src={avatarUrl}
                    alt={`${currentUser.name} profile`}
                    className="profile-avatar"
                  />
                </button>
                {showProfileMenu && (
                  <div className="profile-menu" role="menu">
                    <strong>{currentUser.name}</strong>
                    <span>{currentUser.email}</span>
                    <button type="button" onClick={handleLogout}>Logout</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="roulette-page-grid">
          <section className="wallet-panel">
            <h2>Wallet</h2>
            <div className="wallet-grid">
              <article>
                <span>Total Balance</span>
                <strong>{formatCurrency(wallet.usdBalance)}</strong>
              </article>
              <article>
                <span>Available</span>
                <strong>{formatCurrency(availableBalance)}</strong>
              </article>
              {/* <article>
                <span>Promo Bonus</span>
                <strong>{formatCurrency(wallet.bonus)}</strong>
              </article> */}
            </div>
            {message && <div className="success-message" role="status" aria-live="polite">{message}</div>}
            {error && <p className="trade-error" role="alert">{error}</p>}
          </section>

          <section className="roulette-panel">
            <div className="roulette-bet-controls">
              <div className="roulette-bet-row">
                <label htmlFor="rouletteBetType">Bet Type</label>
                <select
                  id="rouletteBetType"
                  value={betType}
                  onChange={(event) => {
                    setBetType(event.target.value);
                    setError('');
                  }}
                  disabled={isSpinning}
                >
                  <option value="red">Red</option>
                  <option value="black">Black</option>
                  <option value="odd">Odd</option>
                  <option value="even">Even</option>
                  <option value="straight">Straight (single number)</option>
                </select>
              </div>

              {betType === 'straight' && (
                <div className="roulette-bet-row">
                  <label htmlFor="rouletteStraightNumber">Number (0-36)</label>
                  <input
                    id="rouletteStraightNumber"
                    type="number"
                    min="0"
                    max="36"
                    step="1"
                    value={straightNumber}
                    onChange={(event) => {
                      setStraightNumber(event.target.value);
                      setError('');
                    }}
                    disabled={isSpinning}
                  />
                </div>
              )}

              <div className="roulette-bet-row">
                <label htmlFor="rouletteBetAmount">Bet Amount (USD)</label>
                <div className="roulette-bet-amount-row">
                  <input
                    id="rouletteBetAmount"
                    type="number"
                    min="1"
                    step="1"
                    value={betAmount}
                    onChange={(event) => {
                      setBetAmount(event.target.value);
                      setError('');
                    }}
                    disabled={isSpinning}
                  />
                  <button
                    type="button"
                    className="roulette-max-btn"
                    onClick={() => {
                      setBetAmount(Math.max(0, Math.floor(availableBalance)).toString());
                      setError('');
                    }}
                    disabled={isSpinning || availableBalance <= 0}
                  >
                    Max
                  </button>
                </div>
                <div className="roulette-bet-quick">
                  {[10, 25, 50, 100].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setBetAmount(String(chip));
                        setError('');
                      }}
                      disabled={isSpinning}
                    >
                      ${chip}
                    </button>
                  ))}
                </div>
              </div>

              <p className="roulette-bet-hint">
                Max possible win this bet: {formatCurrency(estimatedMaxWin)}
              </p>
              <p className="roulette-bet-hint">Available balance: {formatCurrency(availableBalance)}</p>
              <p className="roulette-updated">Last spin: {formatTime(lastSpinAt)}</p>
            </div>

            <div className="roulette-actions">
              <button
                type="button"
                className="roulette-spin-btn"
                onClick={handleSpin}
                disabled={!canSpin}
              >
                {isSpinning ? 'Spinning...' : 'Spin'}
              </button>
              <button
                type="button"
                className="roulette-reset-btn"
                onClick={handleReset}
                disabled={isSpinning}
              >
                New Game
              </button>
            </div>

            <div className="roulette-plate">
              <div className="roulette-pointer" aria-hidden="true" />
              <div className={`roulette-mask ${isSpinning ? 'active' : ''}`}>{maskText}</div>
              <div
                className="roulette-wheel"
                style={{
                  transform: `rotate(${rotationDeg}deg)`,
                  transition: isSpinning ? `transform ${SPIN_DURATION_MS}ms ease-out` : 'none',
                }}
              >
                <svg className="roulette-svg" viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="49.2" className="roulette-rim" />
                  {wheelSegments.map((segment) => (
                    <path
                      key={`segment-${segment.num}`}
                      d={segment.path}
                      className={`roulette-pocket roulette-pocket-${segment.color}`}
                    />
                  ))}
                  {wheelSegments.map((segment) => (
                    <text
                      key={`label-${segment.num}`}
                      x={segment.textPos.x}
                      y={segment.textPos.y}
                      className="roulette-pocket-label"
                      transform={`rotate(${segment.mid + 90} ${segment.textPos.x} ${segment.textPos.y})`}
                    >
                      {segment.num}
                    </text>
                  ))}
                  <circle cx="50" cy="50" r="27.2" className="roulette-inner-ring" />
                  <circle cx="50" cy="50" r="12.6" className="roulette-hub" />
                  <circle cx="50" cy="50" r="3.2" className="roulette-core" />
                </svg>
              </div>
            </div>

            <div className={`roulette-result-card ${result ? 'show' : ''}`}>
              <div className="roulette-result-number">{result?.number ?? '--'}</div>
              <div className="roulette-result-color">{result?.color ?? 'waiting'}</div>
            </div>

            <ol className="roulette-history">
              {!history.length && <li className="roulette-history-empty">No results yet.</li>}
              {history.map((entry, index) => (
                <li key={`${entry.number}-${index}`} className={`roulette-history-item color-${entry.color}`}>
                  <span>{entry.number}</span>
                  <span>{entry.color}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </Box>
    </ThemeProvider>
  );
}
