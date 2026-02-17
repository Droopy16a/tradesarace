import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/auth-db';
import { getSessionUserIdFromRequest } from '../../../../src/lib/session';

const DEFAULT_WALLET = {
  usdBalance: 20000,
  btcBalance: 0.35,
  bonus: 185,
};

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeWallet(wallet) {
  if (
    wallet &&
    typeof wallet.usdBalance === 'number' &&
    Number.isFinite(wallet.usdBalance) &&
    typeof wallet.btcBalance === 'number' &&
    Number.isFinite(wallet.btcBalance) &&
    typeof wallet.bonus === 'number' &&
    Number.isFinite(wallet.bonus)
  ) {
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
      Number.isFinite(position.leverage) &&
      position.leverage > 0 &&
      typeof position.amount === 'number' &&
      Number.isFinite(position.amount) &&
      position.amount > 0 &&
      typeof position.executionPrice === 'number' &&
      Number.isFinite(position.executionPrice) &&
      position.executionPrice > 0
    ))
    .map((position) => ({
      ...position,
      placedAt: position.placedAt || new Date().toISOString(),
    }));
}

async function fetchMarkPrice(currency) {
  const response = await fetch(
    `https://price-api.crypto.com/price/v2/h/${currency}/?t=${Date.now()}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error('Failed to fetch mark price.');
  }
  const payload = await response.json();
  const prices = payload?.prices || [];
  const latest = Number(prices[prices.length - 1]?.[1]);
  if (!Number.isFinite(latest) || latest <= 0) {
    throw new Error('Invalid mark price.');
  }
  return latest;
}

function getPositionPnl(position, markPrice) {
  const direction = position.side === 'buy' ? 1 : -1;
  return (markPrice - position.executionPrice) * position.amount * direction * position.leverage;
}

export async function POST(request) {
  const userId = getSessionUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const positionId = String(body?.positionId || '').trim();
    const closeAll = Boolean(body?.closeAll);
    const currencyFilter = body?.currency ? String(body.currency).trim().toLowerCase() : null;

    if (!positionId && !closeAll) {
      return NextResponse.json(
        { ok: false, message: 'positionId or closeAll is required.' },
        { status: 400 }
      );
    }

    const result = await query(
      'SELECT wallet_json, positions_json FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    if (!user) {
      return NextResponse.json({ ok: false, message: 'User not found.' }, { status: 404 });
    }

    const wallet = normalizeWallet(parseJson(user.wallet_json, DEFAULT_WALLET));
    const positions = normalizePositions(parseJson(user.positions_json, []));

    const targetPositions = closeAll
      ? positions.filter((position) => !currencyFilter || position.currency === currencyFilter)
      : positions.filter((position) => position.id === positionId);

    if (!targetPositions.length) {
      return NextResponse.json(
        { ok: false, message: 'Position not found.' },
        { status: 404 }
      );
    }

    const markPrices = new Map();
    for (const position of targetPositions) {
      if (!markPrices.has(position.currency)) {
        markPrices.set(position.currency, await fetchMarkPrice(position.currency));
      }
    }

    let totalPnl = 0;
    for (const position of targetPositions) {
      totalPnl += getPositionPnl(position, markPrices.get(position.currency));
    }

    const closedIds = new Set(targetPositions.map((position) => position.id));
    const nextPositions = positions.filter((position) => !closedIds.has(position.id));
    const nextWallet = {
      ...wallet,
      usdBalance: wallet.usdBalance + totalPnl,
    };

    await query(
      'UPDATE users SET wallet_json = $1::jsonb, positions_json = $2::jsonb WHERE id = $3',
      [JSON.stringify(nextWallet), JSON.stringify(nextPositions), userId]
    );

    return NextResponse.json({
      ok: true,
      wallet: nextWallet,
      positions: nextPositions,
      closedCount: targetPositions.length,
      closedPnl: totalPnl,
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Unable to close position.' },
      { status: 500 }
    );
  }
}
