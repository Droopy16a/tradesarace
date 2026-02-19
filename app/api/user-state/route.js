import { NextResponse } from 'next/server';
import { query } from '../../../src/lib/auth-db';
import { getSessionUserIdFromRequest } from '../../../src/lib/session';

const DEFAULT_WALLET = {
  usdBalance: 20000,
  btcBalance: 0.35,
  bonus: 185,
};
const MIN_ORDER_SIZE = 0.001;
const MAX_CLIENT_PRICE_DEVIATION = 0.2;
const ALLOWED_LEVERAGE = new Set([1, 2, 3, 5, 10, 20, 50]);

function isValidWalletShape(wallet) {
  return (
    wallet &&
    typeof wallet.usdBalance === 'number' &&
    Number.isFinite(wallet.usdBalance) &&
    typeof wallet.btcBalance === 'number' &&
    Number.isFinite(wallet.btcBalance) &&
    typeof wallet.bonus === 'number' &&
    Number.isFinite(wallet.bonus)
  );
}

function normalizeWallet(wallet) {
  if (isValidWalletShape(wallet)) {
    return wallet;
  }
  return DEFAULT_WALLET;
}

function normalizePositions(positions) {
  if (!Array.isArray(positions)) return [];

  return positions
    .filter((position) => (
      position &&
      typeof position.id === 'string' &&
      typeof position.currency === 'string' &&
      (position.side === 'buy' || position.side === 'sell') &&
      typeof position.leverage === 'number' &&
      typeof position.amount === 'number' &&
      typeof position.executionPrice === 'number'
    ))
    .map((position) => ({
      ...position,
      placedAt: position.placedAt || new Date().toISOString(),
    }));
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function calculateAvailableBalance(wallet, positions) {
  const marginInUse = positions.reduce((total, pos) => (
    total + ((pos.amount * pos.executionPrice) / pos.leverage)
  ), 0);
  return wallet.usdBalance - marginInUse;
}

function isValidPositivePrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseClientPrice(value) {
  const parsed = Number(value);
  return isValidPositivePrice(parsed) ? parsed : null;
}

function isWithinDeviation(candidate, reference, maxDeviation = MAX_CLIENT_PRICE_DEVIATION) {
  if (!isValidPositivePrice(reference)) return true;
  const deviation = Math.abs(candidate - reference) / reference;
  return deviation <= maxDeviation;
}

async function fetchPriceFromCryptoCom(currency) {
  try {
    const response = await fetch(
      `https://price-api.crypto.com/price/v2/h/${encodeURIComponent(currency)}?t=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const prices = payload?.prices;
    if (!Array.isArray(prices) || prices.length === 0) return null;
    const latest = Number(prices[prices.length - 1]?.[1]);
    return isValidPositivePrice(latest) ? latest : null;
  } catch {
    return null;
  }
}

async function resolveMarketPrice({ currency, clientPrice, referencePrice = null }) {
  const trustedPrice = await fetchPriceFromCryptoCom(currency);
  if (isValidPositivePrice(trustedPrice)) {
    return { price: trustedPrice, source: 'server' };
  }

  const fallbackPrice = parseClientPrice(clientPrice);
  if (!isValidPositivePrice(fallbackPrice)) return null;
  if (!isWithinDeviation(fallbackPrice, referencePrice)) return null;
  return { price: fallbackPrice, source: 'client_fallback' };
}

async function loadUserState(userId) {
  const result = await query(
    'SELECT id, wallet_json, positions_json FROM users WHERE id = $1',
    [userId]
  );
  if (!result.rowCount) return null;

  const user = result.rows[0];
  return {
    wallet: normalizeWallet(parseJson(user.wallet_json, DEFAULT_WALLET)),
    positions: normalizePositions(parseJson(user.positions_json, [])),
  };
}

async function saveUserState(userId, wallet, positions) {
  await query(
    `UPDATE users
     SET wallet_json = $1::jsonb,
         positions_json = $2::jsonb
     WHERE id = $3`,
    [JSON.stringify(wallet), JSON.stringify(positions), userId]
  );
}

export async function GET(request) {
  const userId = getSessionUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { ok: false, message: 'Unauthorized.' },
      { status: 401 }
    );
  }

  try {
    const result = await query(
      'SELECT id, wallet_json, positions_json FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];

    if (!user) {
      return NextResponse.json(
        { ok: false, message: 'User not found.' },
        { status: 404 }
      );
    }

    const wallet = normalizeWallet(parseJson(user.wallet_json, DEFAULT_WALLET));
    const positions = normalizePositions(parseJson(user.positions_json, []));

    return NextResponse.json({ ok: true, wallet, positions });
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Unable to load user state.' },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  const userId = getSessionUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { ok: false, message: 'Unauthorized.' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const action = String(body?.action || '');
    const userState = await loadUserState(userId);

    if (!userState) {
      return NextResponse.json(
        { ok: false, message: 'User not found.' },
        { status: 404 }
      );
    }

    const wallet = userState.wallet;
    const positions = userState.positions;

    if (action === 'open') {
      const currency = String(body?.currency || '').trim().toLowerCase();
      const side = body?.side === 'sell' ? 'sell' : body?.side === 'buy' ? 'buy' : null;
      const leverage = Number(body?.leverage);
      const amount = Number(body?.amount);
      const clientPrice = parseClientPrice(body?.clientPrice);
      const stopLoss = body?.stopLoss == null ? null : Number(body.stopLoss);
      const takeProfit = body?.takeProfit == null ? null : Number(body.takeProfit);

      if (!currency || !side) {
        return NextResponse.json(
          { ok: false, message: 'Invalid order payload.' },
          { status: 400 }
        );
      }
      if (!ALLOWED_LEVERAGE.has(leverage)) {
        return NextResponse.json(
          { ok: false, message: 'Unsupported leverage.' },
          { status: 400 }
        );
      }
      if (!Number.isFinite(amount) || amount < MIN_ORDER_SIZE) {
        return NextResponse.json(
          { ok: false, message: 'Minimum order size is 0.001.' },
          { status: 400 }
        );
      }

      const sameCurrencyPositions = positions.filter((position) => position.currency === currency);
      const referencePrice = sameCurrencyPositions.length
        ? Number(sameCurrencyPositions[sameCurrencyPositions.length - 1]?.executionPrice)
        : null;
      const resolvedPrice = await resolveMarketPrice({
        currency,
        clientPrice,
        referencePrice,
      });
      if (!resolvedPrice) {
        return NextResponse.json(
          { ok: false, message: 'Live price is unavailable.' },
          { status: 503 }
        );
      }
      const executionPrice = resolvedPrice.price;

      if (Number.isFinite(stopLoss) && stopLoss > 0) {
        if (side === 'buy' && stopLoss >= executionPrice) {
          return NextResponse.json(
            { ok: false, message: 'Stop loss must be below entry for long positions.' },
            { status: 400 }
          );
        }
        if (side === 'sell' && stopLoss <= executionPrice) {
          return NextResponse.json(
            { ok: false, message: 'Stop loss must be above entry for short positions.' },
            { status: 400 }
          );
        }
      }

      if (Number.isFinite(takeProfit) && takeProfit > 0) {
        if (side === 'buy' && takeProfit <= executionPrice) {
          return NextResponse.json(
            { ok: false, message: 'Take profit must be above entry for long positions.' },
            { status: 400 }
          );
        }
        if (side === 'sell' && takeProfit >= executionPrice) {
          return NextResponse.json(
            { ok: false, message: 'Take profit must be below entry for short positions.' },
            { status: 400 }
          );
        }
      }

      const requiredMargin = (amount * executionPrice) / leverage;
      const availableBalance = calculateAvailableBalance(wallet, positions);
      if (requiredMargin > availableBalance) {
        return NextResponse.json(
          { ok: false, message: 'Insufficient available balance.' },
          { status: 400 }
        );
      }

      const nextPositions = [
        ...positions,
        {
          id: `${currency}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          currency,
          side,
          orderType: 'market',
          leverage,
          amount,
          executionPrice,
          stopLoss: Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : null,
          takeProfit: Number.isFinite(takeProfit) && takeProfit > 0 ? takeProfit : null,
          placedAt: new Date().toISOString(),
        },
      ];

      await saveUserState(userId, wallet, nextPositions);
      return NextResponse.json({
        ok: true,
        message: resolvedPrice.source === 'client_fallback'
          ? 'Position opened (fallback client price).'
          : 'Position opened.',
        wallet,
        positions: nextPositions,
      });
    }

    if (action === 'close') {
      const positionId = String(body?.positionId || '');
      const clientPrice = parseClientPrice(body?.clientPrice);
      if (!positionId) {
        return NextResponse.json(
          { ok: false, message: 'Position id is required.' },
          { status: 400 }
        );
      }

      const position = positions.find((p) => p.id === positionId);
      if (!position) {
        return NextResponse.json(
          { ok: false, message: 'Position not found.' },
          { status: 404 }
        );
      }

      const resolvedPrice = await resolveMarketPrice({
        currency: position.currency,
        clientPrice,
        referencePrice: Number(position.executionPrice),
      });
      if (!resolvedPrice) {
        return NextResponse.json(
          { ok: false, message: 'Live price is unavailable.' },
          { status: 503 }
        );
      }
      const latestPrice = resolvedPrice.price;

      const direction = position.side === 'buy' ? 1 : -1;
      const pnl =
        (latestPrice - position.executionPrice) *
        position.amount *
        direction *
        position.leverage;
      const nextWallet = {
        ...wallet,
        usdBalance: wallet.usdBalance + pnl,
      };
      const nextPositions = positions.filter((p) => p.id !== position.id);

      await saveUserState(userId, nextWallet, nextPositions);
      return NextResponse.json({
        ok: true,
        message: `${resolvedPrice.source === 'client_fallback' ? '[Fallback] ' : ''}Position closed. PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD`,
        wallet: nextWallet,
        positions: nextPositions,
      });
    }

    if (action === 'closeAll') {
      const currency = String(body?.currency || '').trim().toLowerCase();
      const clientPrice = parseClientPrice(body?.clientPrice);
      const marketPositions = positions.filter((p) => p.currency === currency);

      if (!currency || marketPositions.length === 0) {
        return NextResponse.json({
          ok: true,
          message: 'No positions to close.',
          wallet,
          positions,
        });
      }

      const referencePrice = marketPositions.length
        ? marketPositions.reduce((acc, position) => acc + Number(position.executionPrice), 0) / marketPositions.length
        : null;
      const resolvedPrice = await resolveMarketPrice({
        currency,
        clientPrice,
        referencePrice,
      });
      if (!resolvedPrice) {
        return NextResponse.json(
          { ok: false, message: 'Live price is unavailable.' },
          { status: 503 }
        );
      }
      const latestPrice = resolvedPrice.price;

      const pnl = marketPositions.reduce((acc, position) => {
        const direction = position.side === 'buy' ? 1 : -1;
        return acc + (
          (latestPrice - position.executionPrice) *
          position.amount *
          direction *
          position.leverage
        );
      }, 0);

      const nextWallet = {
        ...wallet,
        usdBalance: wallet.usdBalance + pnl,
      };
      const nextPositions = positions.filter((p) => p.currency !== currency);

      await saveUserState(userId, nextWallet, nextPositions);
      return NextResponse.json({
        ok: true,
        message: `${resolvedPrice.source === 'client_fallback' ? '[Fallback] ' : ''}All positions closed. Net PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD`,
        wallet: nextWallet,
        positions: nextPositions,
      });
    }

    if (action === 'walletAdjust') {
      const amount = Number(body?.amount);
      const reason = String(body?.reason || 'Balance adjusted.');

      if (!Number.isFinite(amount) || amount === 0) {
        return NextResponse.json(
          { ok: false, message: 'Adjustment amount must be a non-zero number.' },
          { status: 400 }
        );
      }

      const availableBalance = calculateAvailableBalance(wallet, positions);
      if (amount < 0 && Math.abs(amount) > availableBalance) {
        return NextResponse.json(
          { ok: false, message: 'Insufficient available balance.' },
          { status: 400 }
        );
      }

      const nextWallet = {
        ...wallet,
        usdBalance: wallet.usdBalance + amount,
      };

      await saveUserState(userId, nextWallet, positions);
      return NextResponse.json({
        ok: true,
        message: reason,
        wallet: nextWallet,
        positions,
      });
    }

    return NextResponse.json(
      { ok: false, message: 'Unsupported action.' },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Unable to update user state.' },
      { status: 500 }
    );
  }
}
