'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import App from './App';
import { clearStoredUser } from './lib/auth-client';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const defaultMarkets = [
  { currency: 'bitcoin', label: 'BTC/USD' },
  { currency: 'ethereum', label: 'ETH/USD' },
  { currency: 'solana', label: 'SOL/USD' },
  { currency: 'dogecoin', label: 'DOGE/USD' },
];

const baseMarket = { currency: 'bitcoin', label: 'BTC/USD', symbol: 'BTC' };

const fallbackTokenOptions = defaultMarkets.map((market) => ({
  id: market.currency,
  symbol: market.label.split('/')[0],
  name: market.currency[0].toUpperCase() + market.currency.slice(1),
  label: market.label,
}));

const WALLET_STORAGE_KEY = 'tradesarace_wallet_v1';
const POSITIONS_STORAGE_KEY = 'tradesarace_positions_v1';
const OPEN_TABS_STORAGE_KEY = 'tradesarace_open_tabs_v1';
const ACTIVE_TAB_STORAGE_KEY = 'tradesarace_active_tab_v1';
const WORKSPACE_MODE_STORAGE_KEY = 'tradesarace_workspace_mode_v1';
const DEFAULT_WALLET = {
  usdBalance: 20000,
  btcBalance: 0.35,
  bonus: 185,
};

function getMarketForCurrency(currency, options = []) {
  const normalizedCurrency = String(currency || '').trim().toLowerCase();
  if (!normalizedCurrency) return baseMarket;

  const token = options.find((entry) => entry.id === normalizedCurrency);
  if (token) {
    return {
      currency: normalizedCurrency,
      label: token.label || `${token.symbol || normalizedCurrency.toUpperCase()}/USD`,
      symbol: token.symbol || normalizedCurrency.toUpperCase(),
    };
  }

  const fallback = fallbackTokenOptions.find((entry) => entry.id === normalizedCurrency);
  if (fallback) {
    return {
      currency: normalizedCurrency,
      label: fallback.label,
      symbol: fallback.symbol,
    };
  }

  return {
    currency: normalizedCurrency,
    label: `${normalizedCurrency.toUpperCase()}/USD`,
    symbol: normalizedCurrency.toUpperCase(),
  };
}

function normalizeStoredMarkets(value) {
  if (!Array.isArray(value)) return [];

  const deduped = [];
  const seen = new Set();

  value.forEach((entry) => {
    const currency = String(entry?.currency || '').trim().toLowerCase();
    const label = String(entry?.label || '').trim();
    const symbol = String(entry?.symbol || '').trim().toUpperCase();
    if (!currency || !label || seen.has(currency)) return;
    seen.add(currency);
    deduped.push({ currency, label, symbol: symbol || label.split('/')[0] || currency.toUpperCase() });
  });

  return deduped;
}

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
  const [workspaceMode, setWorkspaceMode] = useState('market');
  const [hasInitializedWorkspaceMode, setHasInitializedWorkspaceMode] = useState(false);
  const [markets, setMarkets] = useState([baseMarket]);
  const [activeTab, setActiveTab] = useState(0);
  const [tokenOptions, setTokenOptions] = useState(fallbackTokenOptions);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [hasInitializedTabs, setHasInitializedTabs] = useState(false);
  const [sharedWallet, setSharedWallet] = useState(DEFAULT_WALLET);
  const [sharedPositions, setSharedPositions] = useState([]);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isStateReady, setIsStateReady] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileWrapRef = useRef(null);

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY);
      if (storedMode === 'market' || storedMode === 'games') {
        setWorkspaceMode(storedMode);
      }
    } catch {}
    setHasInitializedWorkspaceMode(true);
  }, []);

  useEffect(() => {
    if (!hasInitializedWorkspaceMode) return;
    localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, workspaceMode);
  }, [workspaceMode, hasInitializedWorkspaceMode]);

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

  useEffect(() => {
    if (!hasHydrated || !isStateReady) return;

    if (!currentUser) {
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(sharedWallet));
      localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(sharedPositions));
    }
  }, [sharedWallet, sharedPositions, currentUser, hasHydrated, isStateReady]);

  useEffect(() => {
    if (!hasHydrated || !isStateReady || hasInitializedTabs) return;

    try {
      const storedTabsRaw = localStorage.getItem(OPEN_TABS_STORAGE_KEY);
      const storedActiveRaw = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      const storedTabs = normalizeStoredMarkets(storedTabsRaw ? JSON.parse(storedTabsRaw) : []);

      if (storedTabs.length) {
        const safeIndex = Math.min(
          Math.max(Number.parseInt(storedActiveRaw || '0', 10) || 0, 0),
          storedTabs.length - 1
        );
        setMarkets(storedTabs);
        setActiveTab(safeIndex);
        setHasInitializedTabs(true);
        return;
      }
    } catch {}

    const currenciesFromPositions = Array.from(
      new Set(sharedPositions.map((position) => String(position.currency || '').trim().toLowerCase()).filter(Boolean))
    );

    const nextMarkets = currenciesFromPositions.length
      ? currenciesFromPositions.map((currency) => getMarketForCurrency(currency, tokenOptions))
      : [baseMarket];

    setMarkets(nextMarkets);
    setActiveTab(0);
    setHasInitializedTabs(true);
  }, [hasHydrated, isStateReady, hasInitializedTabs, sharedPositions, tokenOptions]);

  useEffect(() => {
    if (!hasInitializedTabs) return;

    const safeActive = Math.min(activeTab, Math.max(markets.length - 1, 0));
    if (safeActive !== activeTab) {
      setActiveTab(safeActive);
      return;
    }

    localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(markets));
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, String(safeActive));
  }, [markets, activeTab, hasInitializedTabs]);

  useEffect(() => {
    let isActive = true;

    async function loadTokens() {
      setTokenLoading(true);

      try {
        const response = await fetch('/api/crypto-tokens', { cache: 'no-store' });
        const payload = await response.json();
        if (!isActive) return;

        if (response.ok && payload?.ok && Array.isArray(payload.tokens)) {
          setTokenOptions(payload.tokens);
        }
      } catch {
        if (isActive) setTokenOptions(fallbackTokenOptions);
      } finally {
        if (isActive) setTokenLoading(false);
      }
    }

    loadTokens();

    return () => {
      isActive = false;
    };
  }, []);

  function handleLogout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearStoredUser();
    const guestState = loadGuestState();
    setSharedWallet(guestState.wallet);
    setSharedPositions(guestState.positions);
    setCurrentUser(null);
    setShowProfileMenu(false);
  }

  function handleWorkspaceModeChange(nextMode) {
    setWorkspaceMode(nextMode);
    setShowProfileMenu(false);
  }

  function handleSelectToken(option) {
    if (!option?.id) return;

    const nextMarket = getMarketForCurrency(option.id, tokenOptions);
    const existingIndex = markets.findIndex((market) => market.currency === option.id);

    if (existingIndex >= 0) {
      setActiveTab(existingIndex);
      setSearchValue('');
      return;
    }

    const nextMarkets = [
      ...markets,
      nextMarket,
    ];

    setMarkets(nextMarkets);
    setActiveTab(nextMarkets.length - 1);
    setSearchValue('');
  }

  function handleCloseTab(currencyToClose) {
    setMarkets((currentMarkets) => {
      const closeIndex = currentMarkets.findIndex((market) => market.currency === currencyToClose);
      if (closeIndex < 0) return currentMarkets;

      const reducedMarkets = currentMarkets.filter((market) => market.currency !== currencyToClose);
      const nextMarkets = reducedMarkets.length ? reducedMarkets : [baseMarket];

      setActiveTab((currentTab) => {
        if (!reducedMarkets.length) return 0;
        if (currentTab > closeIndex) return currentTab - 1;
        if (currentTab === closeIndex) return Math.max(0, closeIndex - 1);
        return currentTab;
      });

      return nextMarkets;
    });
  }

  const avatarSeed = encodeURIComponent(currentUser?.name || currentUser?.email || 'User');
  const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${avatarSeed}`;
  const activeMarket = markets[activeTab] || markets[0] || baseMarket;

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
          <div className="workspace-mode-tabs" role="tablist" aria-label="Workspace mode">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceMode === 'market'}
              className={`workspace-mode-tab ${workspaceMode === 'market' ? 'active' : ''}`}
              onClick={() => handleWorkspaceModeChange('market')}
            >
              Market
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceMode === 'games'}
              className={`workspace-mode-tab ${workspaceMode === 'games' ? 'active' : ''}`}
              onClick={() => handleWorkspaceModeChange('games')}
            >
              Games
            </button>
          </div>
          <div className="workspace-topbar-right">
            {!currentUser ? (
              <div className="auth-buttons">
                <Link href="/login" className="auth-link login-btn">Login</Link>
                <Link href="/register" className="auth-link register-btn">Register</Link>
              </div>
            ) : (
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
            )}
          </div>
        </div>
        {workspaceMode === 'market' ? (
          <>
        <div className="workspace-tabs">
          <div className="workspace-tabs-row">
            <Tabs
              value={activeTab}
              onChange={(_, nextValue) => setActiveTab(nextValue)}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                minHeight: { xs: 42, sm: 48 },
                flex: 1,
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
                <Tab
                  key={market.currency}
                  label={(
                    <span className="workspace-tab-label">
                      <img
                        className="workspace-tab-icon"
                        src={`https://static.crypto.com/token/icons/${encodeURIComponent(
                          market.currency
                        )}/color_icon.png`}
                        alt={`${market.label} icon`}
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                      <span>{market.label}</span>
                      {markets.length > 1 && (
                        <button
                          type="button"
                          className="workspace-tab-close"
                          aria-label={`Close ${market.label} tab`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleCloseTab(market.currency);
                          }}
                        >
                          x
                        </button>
                      )}
                    </span>
                  )}
                />
              ))}
            </Tabs>

            <Autocomplete
              className="crypto-search"
              options={tokenOptions}
              loading={tokenLoading}
              autoHighlight
              openOnFocus
              clearOnBlur={false}
              filterOptions={(options, state) => {
                const query = state.inputValue.trim().toLowerCase();
                if (!query) return options.slice(0, 20);

                return options
                  .filter((option) => {
                    const symbol = String(option.symbol || '').toLowerCase();
                    const name = String(option.name || '').toLowerCase();
                    const id = String(option.id || '').toLowerCase();
                    return symbol.includes(query) || name.includes(query) || id.includes(query);
                  })
                  .slice(0, 20);
              }}
              getOptionLabel={(option) => `${option.symbol} - ${option.name}`}
              inputValue={searchValue}
              onInputChange={(_, nextInputValue) => setSearchValue(nextInputValue)}
              onChange={(_, nextValue) => handleSelectToken(nextValue)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Search crypto to add..."
                  size="small"
                />
              )}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  {option.symbol} - {option.name}
                </li>
              )}
              noOptionsText={searchValue ? 'No matching crypto found' : 'Type to search crypto'}
            />
          </div>
        </div>

        <div role="tabpanel" id={`market-tabpanel-${activeTab}`}>
          <App
            currency={activeMarket.currency}
            marketLabelOverride={activeMarket.label}
            wallet={sharedWallet}
            setWallet={setSharedWallet}
            positions={sharedPositions}
            setPositions={setSharedPositions}
            isAuthenticated={!!currentUser}
          />
        </div>
          </>
        ) : (
          <section className="games-grid" aria-label="Games list">
            <Link href="/blackjack" className="game-card blackjack-card">
              <img src="/blackjack.jpg" alt="Blackjack game cover" className="game-card-image" />
              <div className="game-card-suits" aria-hidden="true">&clubs; &diams; &hearts; &spades;</div>
              <h2 className="game-card-title">
                <span>Black</span>
                <span>Jack</span>
              </h2>
            </Link>
            <Link href="/roulette" className="game-card roulette-card">
              <img src="/roulette.png" alt="Roulette game cover" className="game-card-image" />
              <div className="game-card-suits" aria-hidden="true">&clubs; &diams; &hearts; &spades;</div>
              <h2 className="game-card-title">
                <span>Roulette</span>
              </h2>
            </Link>
            <Link href="/flappy" className="game-card flappy-card">
              <img src="/Flappy.png" alt="Flappy game cover" className="game-card-image" />
              <div className="game-card-suits" aria-hidden="true">&clubs; &diams; &hearts; &spades;</div>
              <h2 className="game-card-title">
                <span>Flappy</span>
                <span>Casino</span>
              </h2>
            </Link>
          </section>
        )}
      </Box>
    </ThemeProvider>
  );
}

