'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import BlackjackPanel from './BlackjackPanel';
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

export default function BlackjackWorkspace() {
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [positions, setPositions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isStateReady, setIsStateReady] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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

  async function handleSettle(delta, reason) {
    setError('');
    if (!Number.isFinite(delta)) return false;
    if (delta === 0) {
      setMessage(reason);
      setTimeout(() => setMessage(''), 5000);
      return true;
    }
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
        setError(payload?.message || 'Unable to settle blackjack round.');
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

        <div className="blackjack-page-grid">
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

          <BlackjackPanel
            availableBalance={availableBalance}
            onSettle={handleSettle}
          />
        </div>
      </Box>
    </ThemeProvider>
  );
}
