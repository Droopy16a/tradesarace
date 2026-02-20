import React, { useMemo, useState, useEffect } from 'react';
import Chart from './Chart';
import Leaderboard from './Leaderboard';

function App({
  width = 900,
  height = 520,
  currency = 'bitcoin',
  marketLabelOverride = '',
  wallet: sharedWallet,
  setWallet: setSharedWallet,
  positions: sharedPositions,
  setPositions: setSharedPositions,
  isAuthenticated = false,
}) {
  const marketSymbols = {
    bitcoin: 'BTCUSD',
    ethereum: 'ETHUSD',
    solana: 'SOLUSD',
    dogecoin: 'DOGEUSD',
  };
  const marketLabel = marketLabelOverride || marketSymbols[currency] || `${currency.toUpperCase()}/USD`;
  const marketBaseSymbol = marketLabel.split('/')[0] || currency.toUpperCase();

  const [data, setData] = useState([]);
  const [livePrice, setLivePrice] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [side, setSide] = useState('buy');
  const [leverage, setLeverage] = useState('5');
  const [orderType, setOrderType] = useState('market');
  const [amount, setAmount] = useState('0.01');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [tradeError, setTradeError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [walletTab, setWalletTab] = useState('wallet');
  const [transferQuery, setTransferQuery] = useState('');
  const [transferResults, setTransferResults] = useState([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [transferAmount, setTransferAmount] = useState('100');
  const [transferNote, setTransferNote] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferMessage, setTransferMessage] = useState('');
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const [lastChartUpdate, setLastChartUpdate] = useState(null);
  const [localPositions, setLocalPositions] = useState([]);
  const [localWallet, setLocalWallet] = useState({
    usdBalance: 12500,
    btcBalance: 0.35,
    bonus: 185,
  });
  const [timeStampRequest, setTimeStampRequest] = useState('h');
  const [timeframeRefreshKey, setTimeframeRefreshKey] = useState(0);
  const positions = sharedPositions ?? localPositions;
  const setPositions = setSharedPositions ?? setLocalPositions;
  const wallet = sharedWallet ?? localWallet;
  const setWallet = setSharedWallet ?? setLocalWallet;

  function normalizeUnixTimestamp(rawTimestamp) {
    const n = Number(rawTimestamp);
    return n < 1e12 ? n * 1000 : n;
  }

  function setTimeStampRequestWrapper(value) {
    setData([]);
    setIsLoading(true);
    setTimeStampRequest(value);
    setTimeframeRefreshKey((current) => current + 1);
  }

  useEffect(() => {
    let isActive = true;
    let timeoutId;
    let activeController;

    async function loadChartData(isBackground = false) {
      if (!isBackground) {
        setIsLoading(true);
        setError('');
      }

      activeController = new AbortController();

      try {
        const response = await fetch(
          `https://price-api.crypto.com/price/v2/${timeStampRequest}/${currency}/?t=${Date.now()}`,
          {
            signal: activeController.signal,
            cache: 'no-store',
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch market data (${response.status})`);
        }

        const payload = await response.json();
        if (!payload?.prices?.length) {
          throw new Error('No price data returned from API');
        }

        const normalized = payload.prices.map(([timestamp, price]) => ({
          x: new Date(normalizeUnixTimestamp(timestamp)),
          y: Number(price),
        }));

        if (isActive) {
          setData(normalized);
          setError('');
          setLastChartUpdate(Date.now());
        }
      } catch (fetchError) {
        if (isActive && fetchError.name !== 'AbortError') {
          setError(fetchError.message || 'Unable to load bitcoin chart');
          if (!isBackground) setData([]);
        }
      } finally {
        if (isActive && !isBackground) setIsLoading(false);
        if (isActive) {
          timeoutId = setTimeout(() => loadChartData(true), 10000);
        }
      }
    }

    loadChartData();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      if (activeController) activeController.abort();
    };
  }, [currency, timeStampRequest, timeframeRefreshKey]);

  useEffect(() => {
    let isActive = true;
    let timeoutId;
    let activeController;

    async function loadLivePrice() {
      activeController = new AbortController();

      try {
        const response = await fetch(
          `https://price-api.crypto.com/price/v2/h/${currency}/?t=${Date.now()}`,
          {
            signal: activeController.signal,
            cache: 'no-store',
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch live price (${response.status})`);
        }

        const payload = await response.json();
        const prices = payload?.prices || [];
        const latestHourly = prices[prices.length - 1]?.[1];
        const nextLivePrice = Number(latestHourly) || 0;

        if (isActive && nextLivePrice > 0) {
          setLivePrice(nextLivePrice);
        }
      } catch (fetchError) {
        if (!isActive || fetchError.name === 'AbortError') return;
      } finally {
        if (isActive) {
          timeoutId = setTimeout(loadLivePrice, 10000);
        }
      }
    }

    loadLivePrice();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      if (activeController) activeController.abort();
    };
  }, [currency]);

  const latestPrice = useMemo(() => {
    return livePrice || Number(data[data.length - 1]?.y) || 0;
  }, [livePrice, data]);

  const parsedAmount = Number(amount) || 0;
  const parsedLeverage = Number(leverage) || 1;
  const parsedLimitPrice = Number(limitPrice) || 0;
  const executionPrice = orderType === 'market' ? latestPrice : parsedLimitPrice || latestPrice;
  const notionalValue = parsedAmount * executionPrice;
  const estimatedMargin = parsedLeverage > 0 ? notionalValue / parsedLeverage : 0;

  const marketPositions = useMemo(
    () => positions.filter((position) => position.currency === currency),
    [positions, currency]
  );

  const unrealizedPnl = useMemo(() => {
    if (!marketPositions.length || !latestPrice) return 0;
    return marketPositions.reduce((total, position) => {
      const direction = position.side === 'buy' ? 1 : -1;
      const pnl = (latestPrice - position.executionPrice) * position.amount * direction * position.leverage;
      return total + pnl;
    }, 0);
  }, [marketPositions, latestPrice]);

  const availableBalance = useMemo(() => {
    const marginInUse = positions.reduce((total, pos) => {
      return total + (pos.amount * pos.executionPrice / pos.leverage);
    }, 0);
    return wallet.usdBalance - marginInUse;
  }, [wallet.usdBalance, positions]);

  const positionsSummary = useMemo(() => {
    return marketPositions.reduce(
      (acc, position) => {
        const direction = position.side === 'buy' ? 1 : -1;
        const pnl = latestPrice
          ? (latestPrice - position.executionPrice) * position.amount * direction * position.leverage
          : 0;
        acc.notional += position.amount * position.executionPrice;
        acc.margin += position.amount * position.executionPrice / position.leverage;
        acc.longCount += position.side === 'buy' ? 1 : 0;
        acc.shortCount += position.side === 'sell' ? 1 : 0;
        acc.winning += pnl >= 0 ? 1 : 0;
        return acc;
      },
      { notional: 0, margin: 0, longCount: 0, shortCount: 0, winning: 0 }
    );
  }, [marketPositions, latestPrice]);

  const parsedTransferAmount = Number(transferAmount);
  const hasValidTransferAmount = Number.isFinite(parsedTransferAmount) && parsedTransferAmount > 0;
  const canSubmitTransfer = (
    isAuthenticated
    && Boolean(selectedRecipient?.id)
    && hasValidTransferAmount
    && parsedTransferAmount <= availableBalance
    && !isSubmittingTransfer
  );
  const canSubmitOrder = Boolean(latestPrice) && !isLoading && !isSubmittingOrder;

  useEffect(() => {
    if (isAuthenticated && orderType !== 'market') {
      setOrderType('market');
    }
    if (!isAuthenticated && orderType === 'stop-limit') {
      setOrderType('market');
    }
  }, [isAuthenticated, orderType]);

  function formatCurrency(value) {
    return `$${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatBtc(value, cryptoSymbol = 'BTC') {
    return `${Number(value || 0).toFixed(4)} ${cryptoSymbol}`;
  }

  function formatTime(value) {
    if (!value) return '--:--:--';
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function applyQuickSize(fraction) {
    if (!latestPrice || !parsedLeverage || availableBalance <= 0) return;
    const rawSize = (availableBalance * fraction * parsedLeverage) / latestPrice;
    const normalized = Math.max(0.001, Math.floor(rawSize * 1000) / 1000);
    setAmount(normalized.toFixed(3));
    setTradeError('');
  }

  function handleRetryMarketData() {
    setError('');
    setData([]);
    setIsLoading(true);
    setTimeframeRefreshKey((current) => current + 1);
  }

  function normalizePositionsFromServer(nextPositions) {
    if (!Array.isArray(nextPositions)) return [];
    return nextPositions.map((position) => ({
      ...position,
      placedAt: position.placedAt ? new Date(position.placedAt) : new Date(),
    }));
  }

  async function applyServerAction(actionPayload) {
    try {
      const response = await fetch('/api/user-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actionPayload),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setTradeError(payload?.message || 'Unable to process trade action.');
        return null;
      }

      setWallet(payload.wallet);
      setPositions(normalizePositionsFromServer(payload.positions));
      return payload;
    } catch {
      setTradeError('Network error while updating server state.');
      return null;
    }
  }

  useEffect(() => {
    if (!isAuthenticated || walletTab !== 'transfer') return;

    const queryValue = transferQuery.trim();
    if (queryValue.length < 2) {
      setTransferResults([]);
      return;
    }

    let isActive = true;
    setTransferLoading(true);

    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(`/api/users-search?q=${encodeURIComponent(queryValue)}`, {
          cache: 'no-store',
        });
        const payload = await response.json();

        if (!isActive) return;
        if (!response.ok || !payload?.ok) {
          setTransferResults([]);
          return;
        }
        setTransferResults(payload.users || []);
      } catch {
        if (isActive) setTransferResults([]);
      } finally {
        if (isActive) setTransferLoading(false);
      }
    }, 250);

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [transferQuery, isAuthenticated, walletTab]);

  async function handleTransferSubmit(event) {
    event.preventDefault();
    setTransferError('');
    setTransferMessage('');

    if (!isAuthenticated) {
      setTransferError('Login is required to transfer funds.');
      return;
    }
    if (!selectedRecipient?.id) {
      setTransferError('Select a recipient first.');
      return;
    }

    const amountValue = Number(transferAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setTransferError('Enter a valid transfer amount.');
      return;
    }
    if (amountValue > availableBalance) {
      setTransferError(`Insufficient available balance. ${formatCurrency(availableBalance)} available.`);
      return;
    }

    setIsSubmittingTransfer(true);

    try {
      const response = await fetch('/api/user-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transfer',
          recipientId: selectedRecipient.id,
          amount: amountValue,
          note: transferNote.trim() || null,
        }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setTransferError(payload?.message || 'Unable to transfer funds.');
        return;
      }

      setWallet(payload.wallet);
      setPositions(normalizePositionsFromServer(payload.positions));
      setTransferMessage(payload.message || 'Transfer completed.');
      setTransferAmount('100');
      setTransferNote('');
      setTransferQuery('');
      setTransferResults([]);
      setSelectedRecipient(null);
      setTimeout(() => setTransferMessage(''), 5000);
    } catch {
      setTransferError('Network error while sending transfer.');
    } finally {
      setIsSubmittingTransfer(false);
    }
  }

  function validateOrder() {
    if (!latestPrice) {
      return 'Live price is not available yet.';
    }
    if (parsedAmount <= 0) {
      return 'Enter a valid order size.';
    }
    if (parsedAmount < 0.001) {
      return `Minimum order size is 0.001 ${marketBaseSymbol}.`;
    }
    if (orderType !== 'market' && parsedLimitPrice <= 0) {
      return 'Limit price must be greater than 0.';
    }
    if (estimatedMargin > availableBalance) {
      return `Insufficient balance. Available: ${formatCurrency(availableBalance)}`;
    }
    if (stopLoss && Number(stopLoss) > 0) {
      const slPrice = Number(stopLoss);
      if (side === 'buy' && slPrice >= executionPrice) {
        return 'Stop loss must be below entry price for long positions.';
      }
      if (side === 'sell' && slPrice <= executionPrice) {
        return 'Stop loss must be above entry price for short positions.';
      }
    }
    if (takeProfit && Number(takeProfit) > 0) {
      const tpPrice = Number(takeProfit);
      if (side === 'buy' && tpPrice <= executionPrice) {
        return 'Take profit must be above entry price for long positions.';
      }
      if (side === 'sell' && tpPrice >= executionPrice) {
        return 'Take profit must be below entry price for short positions.';
      }
    }
    return null;
  }

  async function handlePlaceOrder(event) {
    event.preventDefault();
    setTradeError('');
    setSuccessMessage('');

    const validationError = validateOrder();
    if (validationError) {
      setTradeError(validationError);
      return;
    }

    setIsSubmittingOrder(true);

    try {
      if (isAuthenticated) {
        if (orderType !== 'market') {
          setTradeError('Only market orders are enabled for authenticated accounts.');
          return;
        }

        const result = await applyServerAction({
          action: 'open',
          currency,
          side,
          leverage: parsedLeverage,
          amount: parsedAmount,
          clientPrice: latestPrice,
          stopLoss: Number(stopLoss) || null,
          takeProfit: Number(takeProfit) || null,
        });
        if (!result) return;

        setSuccessMessage(result.message || 'Position opened.');
        setAmount('0.01');
        setLimitPrice('');
        setStopLoss('');
        setTakeProfit('');
        setTimeout(() => setSuccessMessage(''), 5000);
        return;
      }

      const newPosition = {
        id: `${currency}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        currency,
        cryptoSymbol: marketBaseSymbol,
        side,
        orderType,
        leverage: parsedLeverage,
        amount: parsedAmount,
        executionPrice,
        stopLoss: Number(stopLoss) || null,
        takeProfit: Number(takeProfit) || null,
        placedAt: new Date(),
      };

      setPositions((current) => [...current, newPosition]);

      setSuccessMessage(
        `Position opened: ${side === 'buy' ? 'LONG' : 'SHORT'} ${parsedAmount} ${marketLabel} at ${formatCurrency(
          executionPrice
        )} with ${parsedLeverage}x leverage`
      );

      setAmount('0.01');
      setLimitPrice('');
      setStopLoss('');
      setTakeProfit('');
      setTimeout(() => setSuccessMessage(''), 5000);
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  async function handleClosePosition(positionId) {
    if (isAuthenticated) {
      setTradeError('');
      const result = await applyServerAction({
        action: 'close',
        positionId,
        clientPrice: latestPrice,
      });
      if (!result) return;
      setSuccessMessage(result.message || 'Position closed.');
      setTimeout(() => setSuccessMessage(''), 5000);
      return;
    }

    const position = marketPositions.find((p) => p.id === positionId);
    if (!position || !latestPrice) return;

    const direction = position.side === 'buy' ? 1 : -1;
    const pnl = (latestPrice - position.executionPrice) * position.amount * direction * position.leverage;

    setWallet((current) => ({
      ...current,
      usdBalance: current.usdBalance + pnl,
    }));

    setPositions((current) => current.filter((p) => p.id !== positionId));
    setSuccessMessage(
      `Position closed. PnL: ${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`
    );
    setTimeout(() => setSuccessMessage(''), 5000);
  }

  async function handleCloseAllPositions() {
    if (isAuthenticated) {
      setTradeError('');
      const result = await applyServerAction({
        action: 'closeAll',
        currency,
        clientPrice: latestPrice,
      });
      if (!result) return;
      setSuccessMessage(result.message || 'All positions closed.');
      setTimeout(() => setSuccessMessage(''), 5000);
      return;
    }

    if (!marketPositions.length || !latestPrice) return;

    const totals = marketPositions.reduce(
      (acc, position) => {
        const direction = position.side === 'buy' ? 1 : -1;
        const pnl = (latestPrice - position.executionPrice) * position.amount * direction * position.leverage;
        acc.pnl += pnl;
        return acc;
      },
      { pnl: 0 }
    );

    setWallet((current) => ({
      ...current,
      usdBalance: current.usdBalance + totals.pnl,
    }));
    setPositions((current) => current.filter((position) => position.currency !== currency));
    setSuccessMessage(
      `All positions closed. Net PnL: ${totals.pnl >= 0 ? '+' : ''}${formatCurrency(totals.pnl)}`
    );
    setTimeout(() => setSuccessMessage(''), 5000);
  }

  useEffect(() => {
    if (!latestPrice || !marketPositions.length) return;

    marketPositions.forEach((position) => {
      let shouldClose = false;

      if (position.stopLoss) {
        if (position.side === 'buy' && latestPrice <= position.stopLoss) {
          shouldClose = true;
        } else if (position.side === 'sell' && latestPrice >= position.stopLoss) {
          shouldClose = true;
        }
      }

      if (position.takeProfit) {
        if (position.side === 'buy' && latestPrice >= position.takeProfit) {
          shouldClose = true;
        } else if (position.side === 'sell' && latestPrice <= position.takeProfit) {
          shouldClose = true;
        }
      }

      if (shouldClose) {
        void handleClosePosition(position.id);
      }
    });
  }, [latestPrice, marketPositions, isAuthenticated]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>TRADESARACE Pro</h1>
          <p>{currency.toUpperCase()} perpetual simulator</p>
        </div>
        <div className="market-pill">{marketLabel} LIVE</div>
      </header>

      <div className="app-content">
        <section className="market-column">
          <div className="market-stats">
            <article>
              <span>Mark Price</span>
              <strong>{formatCurrency(latestPrice)}</strong>
            </article>
            <article>
              <span>24h Volume</span>
              <strong>$1.82B</strong>
            </article>
            <article>
              <span>Open Interest</span>
              <strong>$4.27B</strong>
            </article>
            <article>
              <span>Last Sync</span>
              <strong>{formatTime(lastChartUpdate)}</strong>
            </article>
          </div>

          <div className="chart-card market-chart-card">
            {isLoading && (
              <div className="market-chart-status" role="status" aria-live="polite">
                <span className="workspace-loader chart-loader" aria-hidden="true" />
                <p>Loading live market data...</p>
              </div>
            )}
            {!isLoading && error && (
              <div className="market-chart-status error" role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  className="market-retry-btn"
                  onClick={handleRetryMarketData}
                >
                  Retry
                </button>
              </div>
            )}
            {!isLoading && !error && (
              <>
                <Chart
                  width={width}
                  height={height}
                  data={data}
                  positions={marketPositions}
                  livePrice={latestPrice}
                  timeStampRequest={timeStampRequest}
                  setTimeStampRequest={setTimeStampRequestWrapper}
                />
                <p className="chart-meta">Updated {formatTime(lastChartUpdate)}</p>
              </>
            )}
          </div>

          {marketPositions.length > 0 && (
            <section className="positions-panel">
              <div className="positions-panel-head">
                <h2>Open Positions ({marketPositions.length})</h2>
                <button
                  type="button"
                  className="close-all-btn"
                  onClick={handleCloseAllPositions}
                >
                  Close All
                </button>
              </div>
              <div className="positions-summary-grid">
                <article>
                  <span>Exposure</span>
                  <strong>{formatCurrency(positionsSummary.notional)}</strong>
                </article>
                <article>
                  <span>Margin In Use</span>
                  <strong>{formatCurrency(positionsSummary.margin)}</strong>
                </article>
                <article>
                  <span>Long / Short</span>
                  <strong>
                    {positionsSummary.longCount} / {positionsSummary.shortCount}
                  </strong>
                </article>
                <article>
                  <span>Winning</span>
                  <strong>{positionsSummary.winning}</strong>
                </article>
              </div>
              <div className="positions-list">
                {marketPositions.map((position) => {
                  const direction = position.side === 'buy' ? 1 : -1;
                  const positionPnl = latestPrice
                    ? (latestPrice - position.executionPrice) * position.amount * direction * position.leverage
                    : 0;
                  const pnlPercentage = latestPrice
                    ? ((latestPrice - position.executionPrice) / position.executionPrice) * 100 * position.leverage
                    : 0;

                  return (
                    <div key={position.id} className="position-card">
                      <div className="position-header">
                        <span className={`position-side ${position.side}`}>
                          {position.side === 'buy' ? 'LONG' : 'SHORT'} {position.leverage}x
                        </span>
                        <span className="position-time">{position.placedAt.toLocaleTimeString()}</span>
                        <button
                          type="button"
                          className="close-position-btn"
                          onClick={() => handleClosePosition(position.id)}
                        >
                          Close
                        </button>
                      </div>
                      <div className="position-details">
                        <div>
                          <span>Size:</span>
                          <strong>{formatBtc(position.amount, position.cryptoSymbol || marketBaseSymbol)}</strong>
                        </div>
                        <div>
                          <span>Entry:</span>
                          <strong>{formatCurrency(position.executionPrice)}</strong>
                        </div>
                        <div>
                          <span>Mark:</span>
                          <strong>{formatCurrency(latestPrice)}</strong>
                        </div>
                        <div>
                          <span>PnL:</span>
                          <strong className={positionPnl >= 0 ? 'up' : 'down'}>
                            {positionPnl >= 0 ? '+' : ''}
                            {formatCurrency(positionPnl)}
                            <span className="pnl-percentage">
                              ({pnlPercentage >= 0 ? '+' : ''}
                              {pnlPercentage.toFixed(2)}%)
                            </span>
                          </strong>
                        </div>
                      </div>
                      {(position.stopLoss || position.takeProfit) && (
                        <div className="position-risk">
                          {position.stopLoss && (
                            <span>SL: {formatCurrency(position.stopLoss)}</span>
                          )}
                          {position.takeProfit && (
                            <span>TP: {formatCurrency(position.takeProfit)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {marketPositions.length === 0 && (
            <section className="positions-panel positions-empty-state">
              <h2>Open Positions</h2>
              <p>No active positions for this market yet.</p>
              <p>Use the order entry panel to open a long or short trade.</p>
            </section>
          )}
        </section>

        <aside className="side-column">
          <section className="wallet-panel">
            <h2>Wallet</h2>
            <div className="wallet-tabs">
              <button
                type="button"
                className={walletTab === 'wallet' ? 'active' : ''}
                onClick={() => setWalletTab('wallet')}
              >
                Wallet
              </button>
              <button
                type="button"
                className={walletTab === 'transfer' ? 'active' : ''}
                onClick={() => setWalletTab('transfer')}
              >
                Transfer
              </button>
            </div>
            {walletTab === 'wallet' && (
              <>
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
              <article>
                <span>Unrealized PnL</span>
                <strong className={unrealizedPnl >= 0 ? 'up' : 'down'}>
                  {unrealizedPnl >= 0 ? '+' : ''}
                  {formatCurrency(unrealizedPnl)}
                </strong>
              </article>
            </div>
            <div className="wallet-actions">
              {/* <button type="button">Deposit</button>
              <button type="button">Withdraw</button> */}
              {/* <button type="button">Transfer</button> */}
            </div>
              </>
            )}
            {walletTab === 'transfer' && (
              <div className="transfer-panel">
                {!isAuthenticated && (
                  <p className="trade-error">Login is required to transfer funds.</p>
                )}
                {isAuthenticated && (
                  <form onSubmit={handleTransferSubmit}>
                    <label htmlFor="transferUserSearch">Search User</label>
                    <input
                      id="transferUserSearch"
                      type="text"
                      value={transferQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTransferQuery(value);
                        setSelectedRecipient(null);
                        setTransferError('');
                      }}
                      placeholder="Type name or email..."
                      autoComplete="off"
                    />

                    {transferLoading && <p className="input-hint">Searching...</p>}
                    {!transferLoading && transferResults.length > 0 && (
                      <div className="transfer-search-results">
                        {transferResults.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            className={`transfer-user-item ${selectedRecipient?.id === user.id ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedRecipient(user);
                              setTransferQuery(user.name);
                              setTransferResults([]);
                              setTransferError('');
                            }}
                          >
                            <strong>{user.name}</strong>
                            <span>{user.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!transferLoading && !selectedRecipient && transferQuery.trim().length >= 2 && transferResults.length === 0 && (
                      <p className="input-hint transfer-empty-note">No matching users found.</p>
                    )}

                    {selectedRecipient && (
                      <p className="input-hint">
                        Sending to: <strong>{selectedRecipient.name}</strong>
                      </p>
                    )}

                    <label htmlFor="transferAmount">Amount (USD)</label>
                    <div className="transfer-amount-row">
                      <input
                        id="transferAmount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={transferAmount}
                        onChange={(event) => {
                          setTransferAmount(event.target.value);
                          setTransferError('');
                        }}
                        placeholder="100"
                      />
                      <button
                        type="button"
                        className="transfer-max-btn"
                        onClick={() => {
                          setTransferAmount(Math.max(0, availableBalance).toFixed(2));
                          setTransferError('');
                        }}
                      >
                        Max
                      </button>
                    </div>

                    <label htmlFor="transferNote">Note (optional)</label>
                    <input
                      id="transferNote"
                      type="text"
                      value={transferNote}
                      onChange={(event) => setTransferNote(event.target.value)}
                      placeholder="For game challenge"
                    />

                    <button type="submit" className="buy-submit" disabled={!canSubmitTransfer}>
                      {isSubmittingTransfer ? 'Sending...' : 'Send Transfer'}
                    </button>
                  </form>
                )}

                {transferError && <p className="trade-error" role="alert">{transferError}</p>}
                {transferMessage && <div className="success-message" role="status" aria-live="polite">{transferMessage}</div>}
              </div>
            )}
          </section>

          <section className="trade-panel">
            <h2>Order Entry</h2>

            {successMessage && (
              <div className="success-message" role="status" aria-live="polite">{successMessage}</div>
            )}

            <div className="side-toggle">
              <button
                type="button"
                className={side === 'buy' ? 'active buy' : ''}
                onClick={() => {
                  setSide('buy');
                  setTradeError('');
                }}
              >
                Buy / Long
              </button>
              <button
                type="button"
                className={side === 'sell' ? 'active sell' : ''}
                onClick={() => {
                  setSide('sell');
                  setTradeError('');
                }}
              >
                Sell / Short
              </button>
            </div>

            <form onSubmit={handlePlaceOrder}>
              <label htmlFor="orderType">Order Type</label>
              <select
                id="orderType"
                value={orderType}
                onChange={(event) => {
                  setOrderType(event.target.value);
                  setTradeError('');
                }}
              >
                <option value="market">Market</option>
                {!isAuthenticated && <option value="limit">Limit</option>}
              </select>
              {isAuthenticated && (
                <p className="trade-form-hint">Account mode currently supports market orders only.</p>
              )}

              <label htmlFor="leverage">Leverage</label>
              <select
                id="leverage"
                value={leverage}
                onChange={(event) => {
                  setLeverage(event.target.value);
                  setTradeError('');
                }}
              >
                {[1, 2, 3, 5, 10, 20, 50].map((value) => (
                  <option key={value} value={value}>
                    {value}x
                  </option>
                ))}
              </select>

              <label htmlFor="amount">Size ({marketBaseSymbol})</label>
              <input
                id="amount"
                type="number"
                min="0.001"
                step="0.001"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setTradeError('');
                }}
                placeholder="Min: 0.001"
              />
              <div className="size-quick-actions">
                <button
                  type="button"
                  onClick={() => applyQuickSize(0.25)}
                  disabled={!latestPrice || availableBalance <= 0}
                >
                  25%
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSize(0.5)}
                  disabled={!latestPrice || availableBalance <= 0}
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickSize(1)}
                  disabled={!latestPrice || availableBalance <= 0}
                >
                  Max
                </button>
              </div>

              {orderType !== 'market' && (
                <>
                  <label htmlFor="limitPrice">Limit Price (USD)</label>
                  <input
                    id="limitPrice"
                    type="number"
                    min="0"
                    step="1"
                    value={limitPrice}
                    onChange={(event) => {
                      setLimitPrice(event.target.value);
                      setTradeError('');
                    }}
                    placeholder="Enter limit price"
                  />
                </>
              )}

              <label htmlFor="stopLoss">
                Stop Loss (optional)
                <span className="input-hint">
                  {side === 'buy' ? 'Below entry' : 'Above entry'}
                </span>
              </label>
              <input
                id="stopLoss"
                type="number"
                min="0"
                step="1"
                value={stopLoss}
                onChange={(event) => {
                  setStopLoss(event.target.value);
                  setTradeError('');
                }}
                placeholder="Stop loss price"
              />

              <label htmlFor="takeProfit">
                Take Profit (optional)
                <span className="input-hint">
                  {side === 'buy' ? 'Above entry' : 'Below entry'}
                </span>
              </label>
              <input
                id="takeProfit"
                type="number"
                min="0"
                step="1"
                value={takeProfit}
                onChange={(event) => {
                  setTakeProfit(event.target.value);
                  setTradeError('');
                }}
                placeholder="Take profit price"
              />

              <div className="order-preview">
                <p>
                  Entry Price: <strong>{formatCurrency(executionPrice)}</strong>
                </p>
                <p>
                  Notional: <strong>{formatCurrency(notionalValue)}</strong>
                </p>
                <p>
                  Required Margin: <strong>{formatCurrency(estimatedMargin)}</strong>
                </p>
                <p>
                  Available: <strong>{formatCurrency(availableBalance)}</strong>
                </p>
              </div>

              {tradeError && <p className="trade-error" role="alert">{tradeError}</p>}

              <button
                type="submit"
                className={side === 'buy' ? 'buy-submit' : 'sell-submit'}
                disabled={!canSubmitOrder}
              >
                {isSubmittingOrder ? 'Submitting...' : side === 'buy' ? 'Open Long' : 'Open Short'}
              </button>
            </form>
          </section>

          <Leaderboard />
        </aside>
      </div>
    </div>
  );
}

export default App;
