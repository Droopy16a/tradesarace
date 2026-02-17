'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import App from './App';
import { clearStoredUser } from './lib/auth-client';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const markets = [
  { currency: 'bitcoin', label: 'BTC/USD' },
  { currency: 'ethereum', label: 'ETH/USD' },
  { currency: 'solana', label: 'SOL/USD' },
  { currency: 'dogecoin', label: 'DOGE/USD' },
];

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

  return positions
    .filter((position) => {
      return (
        position &&
        typeof position.id === 'string' &&
        typeof position.currency === 'string' &&
        (position.side === 'buy' || position.side === 'sell') &&
        typeof position.leverage === 'number' &&
        typeof position.amount === 'number' &&
        typeof position.executionPrice === 'number'
      );
    })
    .map((position) => ({
      ...position,
      placedAt: position.placedAt ? new Date(position.placedAt) : new Date(),
    }));
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

export default function MarketWorkspace() {
  const [activeTab, setActiveTab] = useState(0);
  const [sharedWallet, setSharedWallet] = useState(DEFAULT_WALLET);
  const [sharedPositions, setSharedPositions] = useState([]);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isStateReady, setIsStateReady] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

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
        setSharedWallet(guestState.wallet);
        setSharedPositions(guestState.positions);
      } else {
        try {
          const response = await fetch('/api/user-state', {
            cache: 'no-store',
          });
          const payload = await response.json();

          if (isActive && response.ok && payload?.ok) {
            setSharedWallet(normalizeWallet(payload.wallet));
            setSharedPositions(normalizePositions(payload.positions));
          } else if (isActive) {
            setSharedWallet(DEFAULT_WALLET);
            setSharedPositions([]);
          }
        } catch {
          if (isActive) {
            setSharedWallet(DEFAULT_WALLET);
            setSharedPositions([]);
          }
        }
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
    if (!hasHydrated || !isStateReady) return;

    if (!currentUser) {
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(sharedWallet));
      localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(sharedPositions));
    }
  }, [sharedWallet, sharedPositions, currentUser, hasHydrated, isStateReady]);

  function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearStoredUser();
    const guestState = loadGuestState();
    setSharedWallet(guestState.wallet);
    setSharedPositions(guestState.positions);
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
        <div className="workspace-tabs">
          <Tabs
            value={activeTab}
            onChange={(_, nextValue) => setActiveTab(nextValue)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{
              minHeight: { xs: 42, sm: 48 },
              '.MuiTabs-flexContainer': { gap: { xs: 0.5, sm: 1 } },
              '.MuiTab-root': {
                fontWeight: 700,
                letterSpacing: '0.04em',
                minHeight: { xs: 42, sm: 48 },
                minWidth: { xs: 90, sm: 120 },
                fontSize: { xs: '0.72rem', sm: '0.84rem' },
                px: { xs: 1, sm: 1.5 },
              },
            }}
          >
            {markets.map((market) => (
              <Tab key={market.currency} label={market.label} />
            ))}
          </Tabs>
        </div>

        <div role="tabpanel" id={`market-tabpanel-${activeTab}`}>
          <App
            currency={markets[activeTab].currency}
            wallet={sharedWallet}
            setWallet={setSharedWallet}
            positions={sharedPositions}
            setPositions={setSharedPositions}
            isAuthenticated={!!currentUser}
          />
        </div>
      </Box>
    </ThemeProvider>
  );
}
