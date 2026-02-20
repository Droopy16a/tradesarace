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

const EXP_GROWTH_RATE = 0.16;
const PIPE_CAP_HEIGHT = 12;
const BASE_WIDTH = 720;
const BASE_PLAYABLE_HEIGHT = 320;
const BASE_SCROLL_SPEED = 165;
const BASE_GRAVITY = 1320;
const BASE_FLAP_VELOCITY = -430;
const BASE_MAX_FALL_VELOCITY = 620;
const MAX_DELTA_TIME_SECONDS = 0.05;

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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getScoreSpeedMultiplier(score) {
  const safeScore = Math.max(0, Number(score) || 0);
  const linearBoost = safeScore * 0.028;
  const curveBoost = Math.pow(safeScore, 1.22) * 0.0016;
  return Math.min(1 + linearBoost + curveBoost, 2.35);
}

function getGameMetrics(width, height) {
  const isPortrait = height > width;
  const floorHeight = clamp(height * 0.16, 58, 104);
  const playableHeight = height - floorHeight;
  const widthScale = clamp(width / BASE_WIDTH, 0.7, 1.35);
  const heightScale = clamp(playableHeight / BASE_PLAYABLE_HEIGHT, 0.74, 1.4);
  const motionScale = Math.sqrt(widthScale * heightScale);
  const birdRadius = clamp(width * 0.026, 11, 17);
  const pipeWidth = clamp(width * 0.092, 50, 82);
  const gapSize = clamp(playableHeight * (isPortrait ? 0.35 : 0.31), 130, 210);
  const pipeSpacing = clamp(width * (isPortrait ? 0.5 : 0.53), 200, 340);
  return {
    birdX: width * 0.27,
    birdRadius,
    pipeWidth,
    gapSize,
    pipeSpacing,
    scrollSpeed: BASE_SCROLL_SPEED * motionScale,
    gravity: BASE_GRAVITY * heightScale,
    flapVelocity: BASE_FLAP_VELOCITY * heightScale,
    maxFallVelocity: BASE_MAX_FALL_VELOCITY * heightScale,
    floorHeight,
    playableHeight,
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
    worldTick: 0,
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
    const { width, height, pipes, birdY, birdVelocity, worldTick } = state;
    if (width <= 0 || height <= 0) return;
    const {
      birdX,
      birdRadius,
      pipeWidth,
      gapSize,
      floorHeight,
      playableHeight,
      maxFallVelocity,
    } = getGameMetrics(width, height);

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#61bcff');
    sky.addColorStop(1, '#93e9ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const sunX = width * 0.78;
    const sunY = playableHeight * 0.18;
    const sunRadius = clamp(width * 0.06, 22, 42);
    const sunGlow = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.4, sunX, sunY, sunRadius * 2.2);
    sunGlow.addColorStop(0, 'rgba(255, 247, 196, 0.42)');
    sunGlow.addColorStop(1, 'rgba(255, 247, 196, 0)');
    ctx.fillStyle = sunGlow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius * 2.2, 0, Math.PI * 2);
    ctx.fill();

    const cloudOffsetA = -(worldTick * 0.2) % (width + 260);
    const cloudOffsetB = -(worldTick * 0.32) % (width + 320);
    const cloudW = clamp(width * 0.078, 42, 90);
    const cloudH = clamp(height * 0.036, 16, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = -1; i < 3; i += 1) {
      const baseX = cloudOffsetA + i * 260;
      ctx.beginPath();
      ctx.ellipse(baseX + cloudW * 1.2, playableHeight * 0.2, cloudW, cloudH, 0, 0, Math.PI * 2);
      ctx.ellipse(baseX + cloudW * 2.05, playableHeight * 0.2, cloudW * 0.75, cloudH * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = -1; i < 3; i += 1) {
      const baseX = cloudOffsetB + i * 320;
      ctx.beginPath();
      ctx.ellipse(baseX + cloudW * 1.5, playableHeight * 0.34, cloudW * 1.1, cloudH * 1.05, 0, 0, Math.PI * 2);
      ctx.ellipse(baseX + cloudW * 2.35, playableHeight * 0.34, cloudW * 0.72, cloudH * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const pipeCapHeight = clamp(pipeWidth * 0.26, PIPE_CAP_HEIGHT, 22);
    pipes.forEach((pipe) => {
      const topHeight = pipe.gapY - gapSize / 2;
      const bottomStart = pipe.gapY + gapSize / 2;

      const pipeBody = ctx.createLinearGradient(pipe.x, 0, pipe.x + pipeWidth, 0);
      pipeBody.addColorStop(0, '#39c66b');
      pipeBody.addColorStop(1, '#219a4f');
      ctx.fillStyle = pipeBody;
      ctx.fillRect(pipe.x, 0, pipeWidth, topHeight);
      ctx.fillRect(pipe.x, bottomStart, pipeWidth, playableHeight - bottomStart);

      const pipeLip = ctx.createLinearGradient(pipe.x - 4, 0, pipe.x + pipeWidth + 4, 0);
      pipeLip.addColorStop(0, '#2ca75a');
      pipeLip.addColorStop(1, '#188143');
      ctx.fillStyle = pipeLip;
      ctx.fillRect(pipe.x - 4, Math.max(topHeight - pipeCapHeight, 0), pipeWidth + 8, pipeCapHeight);
      ctx.fillRect(pipe.x - 4, bottomStart, pipeWidth + 8, pipeCapHeight);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(pipe.x + pipeWidth * 0.08, 0, Math.max(pipeWidth * 0.12, 3), topHeight);
      ctx.fillRect(pipe.x + pipeWidth * 0.08, bottomStart, Math.max(pipeWidth * 0.12, 3), playableHeight - bottomStart);
    });

    const tilt = clamp(birdVelocity / Math.max(maxFallVelocity, 1), -1, 1) * 0.55;
    const wingWave = Math.sin(worldTick * 0.08) * birdRadius * 0.16;

    ctx.save();
    ctx.translate(birdX, birdY);
    ctx.rotate(tilt);

    const birdBody = ctx.createRadialGradient(
      -birdRadius * 0.25,
      -birdRadius * 0.35,
      birdRadius * 0.2,
      0,
      0,
      birdRadius * 1.05
    );
    birdBody.addColorStop(0, '#fff7b2');
    birdBody.addColorStop(1, '#f5c111');
    ctx.fillStyle = birdBody;
    ctx.beginPath();
    ctx.arc(0, 0, birdRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#efb100';
    ctx.beginPath();
    ctx.ellipse(-birdRadius * 0.1, wingWave, birdRadius * 0.44, birdRadius * 0.32, -0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(birdRadius * 0.35, -birdRadius * 0.18, birdRadius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2e323f';
    ctx.beginPath();
    ctx.arc(birdRadius * 0.44, -birdRadius * 0.15, birdRadius * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f68d2e';
    ctx.beginPath();
    ctx.moveTo(birdRadius * 0.95, 0);
    ctx.lineTo(birdRadius * 1.35, -birdRadius * 0.18);
    ctx.lineTo(birdRadius * 1.35, birdRadius * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const floorY = playableHeight;
    const floor = ctx.createLinearGradient(0, floorY, 0, height);
    floor.addColorStop(0, '#e6cf79');
    floor.addColorStop(1, '#b99d45');
    ctx.fillStyle = floor;
    ctx.fillRect(0, floorY, width, floorHeight + 1);
    ctx.fillStyle = '#7fbe42';
    ctx.fillRect(0, floorY - 10, width, 12);
    ctx.fillStyle = '#6aa833';
    const tileSize = clamp(width * 0.034, 18, 30);
    const tileOffset = worldTick % (tileSize * 2);
    for (let x = -tileSize * 2; x < width + tileSize * 2; x += tileSize * 2) {
      ctx.fillRect(x - tileOffset, floorY + 2, tileSize, Math.max(floorHeight - 5, 2));
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.17)';
    for (let x = -tileSize * 2; x < width + tileSize * 2; x += tileSize * 2) {
      ctx.fillRect(x - tileOffset + tileSize * 0.2, floorY + 7, tileSize * 0.6, 3);
    }
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const cssWidth = stage.clientWidth;
    const stageRectHeight = stage.clientHeight;
    const stageMinHeight = parseFloat(window.getComputedStyle(stage).minHeight) || 0;
    const viewportWidth = window.innerWidth || cssWidth;
    const isMobile = viewportWidth < 700;
    const viewportHeight = window.innerHeight || 800;
    const desktopHeight = Math.max(Math.min(Math.round(cssWidth * 0.62), 640), 360);
    const portraitMobileHeight = Math.max(
      Math.min(Math.round(cssWidth * 1.35), Math.max(viewportHeight - 210, 480)),
      480
    );
    const baseHeight = isMobile ? portraitMobileHeight : desktopHeight;
    const cssHeight = Math.max(baseHeight, stageRectHeight, stageMinHeight);
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
      gameRef.current.birdY = (cssHeight - getGameMetrics(cssWidth, cssHeight).floorHeight) * 0.5;
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
    const deltaSeconds = Math.min((timestamp - state.lastTime) / 1000, MAX_DELTA_TIME_SECONDS);
    state.lastTime = timestamp;

    const width = state.width;
    const height = state.height;
    const {
      birdX,
      birdRadius,
      pipeWidth,
      gapSize,
      pipeSpacing,
      scrollSpeed,
      gravity,
      maxFallVelocity,
      playableHeight,
    } = getGameMetrics(width, height);
    const speedMultiplier = getScoreSpeedMultiplier(state.score);
    const dynamicPipeSpeed = scrollSpeed * speedMultiplier;

    state.worldTick += dynamicPipeSpeed * deltaSeconds;
    state.birdVelocity += gravity * deltaSeconds;
    state.birdVelocity = Math.min(state.birdVelocity, maxFallVelocity);
    state.birdY += state.birdVelocity * deltaSeconds;

    const shouldSpawnPipe =
      state.pipes.length === 0 ||
      state.pipes[state.pipes.length - 1].x <= width - pipeSpacing;
    if (shouldSpawnPipe) {
      const gapMargin = Math.max(24, birdRadius + 16);
      const minGapY = gapSize / 2 + gapMargin;
      const maxGapY = playableHeight - gapSize / 2 - gapMargin;
      const gapY = maxGapY <= minGapY
        ? playableHeight * 0.5
        : (Math.random() * (maxGapY - minGapY) + minGapY);
      state.pipes.push({ x: width + pipeWidth + 24, gapY, passed: false });
    }

    state.pipes.forEach((pipe) => {
      pipe.x -= dynamicPipeSpeed * deltaSeconds;
      if (!pipe.passed && pipe.x + pipeWidth < birdX - birdRadius) {
        pipe.passed = true;
        state.score += 1;
        setScore(state.score);
      }
    });
    state.pipes = state.pipes.filter((pipe) => pipe.x + pipeWidth > -pipeWidth - 12);

    let collided = state.birdY - birdRadius <= 0 || state.birdY + birdRadius >= playableHeight;
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

  function applyFlapVelocity() {
    const state = gameRef.current;
    const { flapVelocity } = getGameMetrics(state.width, state.height);
    state.birdVelocity = flapVelocity;
  }

  function flap() {
    if (!gameRef.current.running) return;
    applyFlapVelocity();
  }

  function handleStageAction() {
    if (!isRunning && !isSettling) {
      startRun();
      requestAnimationFrame(() => {
        applyFlapVelocity();
      });
      return;
    }
    flap();
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
    state.birdY = getGameMetrics(state.width, state.height).playableHeight * 0.5;
    state.birdVelocity = 0;
    state.pipes = [];
    state.score = 0;
    state.running = true;
    state.lastTime = 0;
    state.worldTick = 0;
    setScore(0);
    setIsRunning(true);

    rafRef.current = requestAnimationFrame(runLoop);
  }

  useEffect(() => {
    if (!isStateReady) return undefined;

    function onKeyDown(event) {
      if (event.code !== 'Space' && event.code !== 'ArrowUp') return;
      event.preventDefault();
      flap();
    }

    resizeCanvas();
    const rafId = requestAnimationFrame(resizeCanvas);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', onKeyDown);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(stageRef.current);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('keydown', onKeyDown);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [isStateReady]);

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

  if (!isStateReady) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Box sx={{ px: { xs: 0.5, sm: 1 }, pt: { xs: 0.5, sm: 1 } }}>
          <div className="workspace-loading" role="status" aria-live="polite">
            <span className="workspace-loader" aria-hidden="true" />
            <p>Loading your workspace...</p>
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
              {/* <article>
                <span>Promo Bonus</span>
                <strong>{formatCurrency(wallet.bonus)}</strong>
              </article> */}
            </div>
            {message && <div className="success-message">{message}</div>}
            {error && <p className="trade-error">{error}</p>}
          </section>

          <section className="flappy-panel">
            <div className="flappy-controls">
              <div className="flappy-input-wrap">
                <label htmlFor="flappyBet">Bet Amount (USD)</label>
                <div className="flappy-bet-row">
                  <input
                    id="flappyBet"
                    type="number"
                    min="1"
                    step="1"
                    value={betAmount}
                    onChange={(event) => {
                      setBetAmount(event.target.value);
                      setError('');
                    }}
                    disabled={isRunning || isSettling}
                  />
                  <button
                    type="button"
                    className="flappy-max-btn"
                    onClick={() => {
                      setBetAmount(Math.max(0, Math.floor(availableBalance)).toString());
                      setError('');
                    }}
                    disabled={isRunning || isSettling || availableBalance <= 0}
                  >
                    Max
                  </button>
                </div>
                {/* <input
                  id="flappyBet"
                  type="number"
                  min="1"
                  step="1"
                  value={betAmount}
                  onChange={(event) => setBetAmount(event.target.value)}
                  disabled={isRunning || isSettling}
                /> */}
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
              onPointerDown={handleStageAction}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  handleStageAction();
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
                  <span>Tap the stage or press Start to launch.</span>
                  <span>PnL formula: (bet * ((1.16^score) - 1)) - bet</span>
                  <button
                    type="button"
                    className="flappy-start-btn"
                    onPointerDown={(event) => event.stopPropagation()}
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
