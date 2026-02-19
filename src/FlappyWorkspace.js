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

const GRAVITY = 0.42;
const FLAP_VELOCITY = -6.7;
const EXP_GROWTH_RATE = 0.16;

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

function computeDelta(score, wager) {
  if (!Number.isFinite(score) || score <= 0 || !Number.isFinite(wager) || wager <= 0) {
    return Number((-Math.abs(wager || 0)).toFixed(2));
  }

  // Exponential reward curve: higher score scales returns faster.
  const grossReturn = wager * (Math.pow(1 + EXP_GROWTH_RATE, score) - 1);
  return Number((grossReturn - wager).toFixed(2));
}

function getScoreSpeedMultiplier(score) {
  const safeScore = Math.max(0, Number(score*2.5) || 0);
  const linearBoost = safeScore * 0.035;
  const curveBoost = Math.pow(safeScore, 1.16) * 0.0032;
  return Math.min(1 + linearBoost + curveBoost, 2.8);
}

function getGameMetrics(width, height) {
  const isPortrait = height > width;
  const birdRadius = Math.max(width * 0.026, 11);
  const pipeWidth = Math.max(width * 0.085, 46);
  const gapSize = isPortrait
    ? Math.min(Math.max(width * 0.32, 120), 160)
    : Math.min(Math.max(width * 0.24, 140), 210);
  const pipeSpacing = isPortrait
    ? Math.min(Math.max(width * 0.44, 170), 230)
    : Math.min(Math.max(width * 0.42, 220), 320);
  const pipeSpeed = isPortrait
    ? Math.min(Math.max(width * 0.0037, 1.95), 2.65)
    : Math.min(Math.max(width * 0.0032, 2.1), 3.1);
  return {
    birdX: width * 0.26,
    birdRadius,
    pipeWidth,
    gapSize,
    pipeSpacing,
    pipeSpeed,
  };
}

export default function FlappyWorkspace() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const settleLockRef = useRef(false);

  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [positions, setPositions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isStateReady, setIsStateReady] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [betAmount, setBetAmount] = useState('25');
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [statusText, setStatusText] = useState('Set your bet and start a run.');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const gameRef = useRef({
    width: 720,
    height: 380,
    birdY: 0,
    birdVelocity: 0,
    pipes: [],
    score: 0,
    running: false,
    lastTime: 0,
  });

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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated || !isStateReady || currentUser) return;
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  }, [wallet, positions, currentUser, hasHydrated, isStateReady]);

  const availableBalance = useMemo(() => {
    const marginInUse = positions.reduce((total, pos) => (
      total + ((Number(pos.amount) || 0) * (Number(pos.executionPrice) || 0) / (Number(pos.leverage) || 1))
    ), 0);
    return wallet.usdBalance - marginInUse;
  }, [wallet.usdBalance, positions]);

  const parsedBetAmount = Number(betAmount);
  const potentialDeltaPreview = useMemo(() => {
    if (!Number.isFinite(parsedBetAmount) || parsedBetAmount <= 0) return 0;
    return computeDelta(score, parsedBetAmount);
  }, [parsedBetAmount, score]);

  function formatCurrency(value) {
    return `$${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function drawScene() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = gameRef.current;
    const { width, height, pipes, birdY } = state;
    const { birdX, birdRadius, pipeWidth, gapSize } = getGameMetrics(width, height);

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#62b8ff');
    sky.addColorStop(1, '#8ee3ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(width * 0.18, height * 0.22, 42, 18, 0, 0, Math.PI * 2);
    ctx.ellipse(width * 0.22, height * 0.22, 32, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(width * 0.75, height * 0.18, 50, 19, 0, 0, Math.PI * 2);
    ctx.ellipse(width * 0.70, height * 0.18, 32, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    pipes.forEach((pipe) => {
      const topHeight = pipe.gapY - gapSize / 2;
      const bottomStart = pipe.gapY + gapSize / 2;

      ctx.fillStyle = '#1f9d4b';
      ctx.fillRect(pipe.x, 0, pipeWidth, topHeight);
      ctx.fillRect(pipe.x, bottomStart, pipeWidth, height - bottomStart);

      ctx.fillStyle = '#177a3a';
      ctx.fillRect(pipe.x - 4, Math.max(topHeight - 12, 0), pipeWidth + 8, 12);
      ctx.fillRect(pipe.x - 4, bottomStart, pipeWidth + 8, 12);
    });

    ctx.fillStyle = '#ffd24b';
    ctx.beginPath();
    ctx.arc(birdX, birdY, birdRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(birdX + birdRadius * 0.35, birdY - birdRadius * 0.15, birdRadius * 0.30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2e323f';
    ctx.beginPath();
    ctx.arc(birdX + birdRadius * 0.45, birdY - birdRadius * 0.12, birdRadius * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f68d2e';
    ctx.beginPath();
    ctx.moveTo(birdX + birdRadius * 0.95, birdY);
    ctx.lineTo(birdX + birdRadius * 1.35, birdY - birdRadius * 0.18);
    ctx.lineTo(birdX + birdRadius * 1.35, birdY + birdRadius * 0.18);
    ctx.closePath();
    ctx.fill();

    // ctx.fillStyle = 'rgba(12,18,32,0.45)';
    // ctx.fillRect(0, 0, width, 44);
    // ctx.fillStyle = '#f3f7ff';
    // ctx.font = `700 ${Math.max(18, Math.round(width * 0.038))}px Space Grotesk`;
    // ctx.textAlign = 'left';
    // ctx.fillText(`Score: ${state.score}`, 14, 30);
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const cssWidth = stage.clientWidth;
    const viewportWidth = window.innerWidth || cssWidth;
    const isMobile = viewportWidth < 700;
    const viewportHeight = window.innerHeight || 800;
    const desktopHeight = Math.max(Math.min(Math.round(cssWidth * 0.62), 640), 360);
    const portraitMobileHeight = Math.max(
      Math.min(Math.round(cssWidth * 1.35), Math.max(viewportHeight - 210, 480)),
      480
    );
    const cssHeight = isMobile ? portraitMobileHeight : desktopHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    gameRef.current.width = cssWidth;
    gameRef.current.height = cssHeight;

    if (!gameRef.current.running) {
      gameRef.current.birdY = cssHeight * 0.5;
      drawScene();
    }
  }

  async function settleRun(finalScore) {
    if (settleLockRef.current) return;
    settleLockRef.current = true;

    const wager = Number(betAmount);
    const delta = computeDelta(finalScore, wager);
    const sign = delta >= 0 ? '+' : '-';
    const reason = `Flappy run score ${finalScore}. PnL: ${sign}${Math.abs(delta).toFixed(2)} USD.`;

    setIsSettling(true);
    setError('');

    if (delta === 0) {
      setMessage(reason);
      setTimeout(() => setMessage(''), 5000);
      setIsSettling(false);
      settleLockRef.current = false;
      return;
    }

    if (delta < 0 && Math.abs(delta) > availableBalance) {
      setError('Insufficient available balance.');
      setIsSettling(false);
      settleLockRef.current = false;
      return;
    }

    if (!currentUser) {
      setWallet((current) => ({
        ...current,
        usdBalance: current.usdBalance + delta,
      }));
      setMessage(reason);
      setTimeout(() => setMessage(''), 5000);
      setIsSettling(false);
      settleLockRef.current = false;
      return;
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
        setError(payload?.message || 'Unable to settle flappy run.');
      } else {
        setWallet(normalizeWallet(payload.wallet));
        setPositions(normalizePositions(payload.positions));
        setMessage(payload.message || reason);
        setTimeout(() => setMessage(''), 5000);
      }
    } catch {
      setError('Network error while settling run.');
    } finally {
      setIsSettling(false);
      settleLockRef.current = false;
    }
  }

  function stopRunAndSettle(finalScore) {
    if (!gameRef.current.running) return;
    gameRef.current.running = false;
    setIsRunning(false);
    setBestScore((current) => Math.max(current, finalScore));
    const runDelta = computeDelta(finalScore, Number(betAmount));
    setStatusText(
      `Run over. Score ${finalScore}. ${runDelta >= 0 ? 'Profit' : 'Loss'} ${formatCurrency(Math.abs(runDelta))}.`
    );
    void settleRun(finalScore);
  }

  function runLoop(timestamp) {
    const state = gameRef.current;
    if (!state.running) return;

    if (!state.lastTime) state.lastTime = timestamp;
    const deltaMs = Math.min(timestamp - state.lastTime, 50);
    const frameScale = deltaMs / 16.67;
    state.lastTime = timestamp;

    const width = state.width;
    const height = state.height;
    const { birdX, birdRadius, pipeWidth, gapSize, pipeSpacing, pipeSpeed } = getGameMetrics(width, height);
    const speedMultiplier = getScoreSpeedMultiplier(state.score);
    const dynamicPipeSpeed = pipeSpeed * speedMultiplier;

    state.birdVelocity += GRAVITY * frameScale;
    state.birdY += state.birdVelocity * frameScale;

    const shouldSpawnPipe =
      state.pipes.length === 0 ||
      state.pipes[state.pipes.length - 1].x <= width - pipeSpacing;
    if (shouldSpawnPipe) {
      const minGapY = gapSize / 2 + 24;
      const maxGapY = height - gapSize / 2 - 24;
      const gapY = Math.random() * (maxGapY - minGapY) + minGapY;
      state.pipes.push({ x: width + 20, gapY, passed: false });
    }

    state.pipes.forEach((pipe) => {
      pipe.x -= dynamicPipeSpeed * frameScale;
      if (!pipe.passed && pipe.x + pipeWidth < birdX - birdRadius) {
        pipe.passed = true;
        state.score += 1;
        setScore(state.score);
      }
    });
    state.pipes = state.pipes.filter((pipe) => pipe.x + pipeWidth > -24);

    let collided = state.birdY - birdRadius <= 0 || state.birdY + birdRadius >= height;
    if (!collided) {
      for (const pipe of state.pipes) {
        const withinX = birdX + birdRadius > pipe.x && birdX - birdRadius < pipe.x + pipeWidth;
        if (!withinX) continue;
        const topGap = pipe.gapY - gapSize / 2;
        const bottomGap = pipe.gapY + gapSize / 2;
        if (state.birdY - birdRadius < topGap || state.birdY + birdRadius > bottomGap) {
          collided = true;
          break;
        }
      }
    }

    drawScene();

    if (collided) {
      stopRunAndSettle(state.score);
      return;
    }

    rafRef.current = requestAnimationFrame(runLoop);
  }

  function flap() {
    if (!gameRef.current.running) return;
    gameRef.current.birdVelocity = FLAP_VELOCITY;
  }

  function validateBeforeStart() {
    if (!Number.isFinite(parsedBetAmount) || parsedBetAmount <= 0) {
      return 'Enter a valid bet amount.';
    }
    if (parsedBetAmount > availableBalance) {
      return 'Bet exceeds available balance.';
    }
    return null;
  }

  function startRun() {
    if (isRunning || isSettling) return;

    const validationError = validateBeforeStart();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    settleLockRef.current = false;
    setError('');
    setMessage('');
    setStatusText('Run active. Tap stage or press Space/ArrowUp to flap.');

    const state = gameRef.current;
    state.birdY = state.height * 0.5;
    state.birdVelocity = 0;
    state.pipes = [];
    state.score = 0;
    state.running = true;
    state.lastTime = 0;
    setScore(0);
    setIsRunning(true);

    rafRef.current = requestAnimationFrame(runLoop);
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.code !== 'Space' && event.code !== 'ArrowUp') return;
      event.preventDefault();
      flap();
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', onKeyDown);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(stageRef.current);
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('keydown', onKeyDown);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, []);

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
            <div className="profile-wrap">
              <button
                type="button"
                className="profile-trigger"
                onClick={() => setShowProfileMenu((open) => !open)}
              >
                <img
                  src={avatarUrl}
                  alt={`${currentUser.name} profile`}
                  className="profile-avatar"
                />
              </button>
              {showProfileMenu && (
                <div className="profile-menu">
                  <strong>{currentUser.name}</strong>
                  <span>{currentUser.email}</span>
                  <button type="button" onClick={handleLogout}>Logout</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flappy-page-grid">
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
              <article>
                <span>Promo Bonus</span>
                <strong>{formatCurrency(wallet.bonus)}</strong>
              </article>
            </div>
            {message && <div className="success-message">{message}</div>}
            {error && <p className="trade-error">{error}</p>}
          </section>

          <section className="flappy-panel">
            <div className="flappy-controls">
              <div className="flappy-input-wrap">
                <label htmlFor="flappyBet">Bet Amount (USD)</label>
                <input
                  id="flappyBet"
                  type="number"
                  min="1"
                  step="1"
                  value={betAmount}
                  onChange={(event) => setBetAmount(event.target.value)}
                  disabled={isRunning || isSettling}
                />
              </div>
              <div className="flappy-chip-row">
                {[10, 25, 50, 100].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="flappy-chip"
                    onClick={() => setBetAmount(String(chip))}
                    disabled={isRunning || isSettling}
                  >
                    ${chip}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`flappy-stage ${isRunning ? 'running' : ''}`}
              ref={stageRef}
              onPointerDown={flap}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  flap();
                }
              }}
            >
              <canvas ref={canvasRef} className="flappy-canvas" />
              <div className="flappy-hud">
                <div className="flappy-hud-row">
                  <span>Score: {score}</span>
                  <span>Best: {bestScore}</span>
                  <span>Bet: {formatCurrency(parsedBetAmount || 0)}</span>
                  <span className={potentialDeltaPreview >= 0 ? 'up' : 'down'}>
                    PnL: {potentialDeltaPreview >= 0 ? '+' : '-'}
                    {formatCurrency(Math.abs(potentialDeltaPreview))}
                  </span>
                </div>
                <p>{statusText}</p>
              </div>
              {!isRunning && (
                <div className="flappy-overlay">
                  <strong>Flappy Casino Run</strong>
                  <span>Reach pipes to increase score.</span>
                  <span>PnL formula: (bet * ((1.16^score) - 1)) - bet</span>
                  <button
                    type="button"
                    className="flappy-start-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      startRun();
                    }}
                    disabled={isRunning || isSettling}
                  >
                    Start Run
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </Box>
    </ThemeProvider>
  );
}
