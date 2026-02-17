import crypto from 'crypto';
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

export async function POST(request) {
  const userId = getSessionUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const currency = String(body?.currency || '').trim().toLowerCase();
    const side = body?.side === 'sell' ? 'sell' : body?.side === 'buy' ? 'buy' : '';
    const orderType = String(body?.orderType || 'market');
    const leverage = Number(body?.leverage);
    const amount = Number(body?.amount);
    const executionPrice = Number(body?.executionPrice);
    const stopLoss = body?.stopLoss == null ? null : Number(body.stopLoss);
    const takeProfit = body?.takeProfit == null ? null : Number(body.takeProfit);

    if (!currency || !side) {
      return NextResponse.json(
        { ok: false, message: 'Invalid trade payload.' },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(leverage) || leverage <= 0 ||
      !Number.isFinite(amount) || amount <= 0 ||
      !Number.isFinite(executionPrice) || executionPrice <= 0
    ) {
      return NextResponse.json(
        { ok: false, message: 'Invalid leverage, amount, or execution price.' },
        { status: 400 }
      );
    }

    if (stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) {
      return NextResponse.json({ ok: false, message: 'Invalid stop loss.' }, { status: 400 });
    }
    if (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0)) {
      return NextResponse.json({ ok: false, message: 'Invalid take profit.' }, { status: 400 });
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
    const marginInUse = positions.reduce((total, position) => (
      total + (position.amount * position.executionPrice / position.leverage)
    ), 0);
    const requiredMargin = amount * executionPrice / leverage;
    const availableBalance = wallet.usdBalance - marginInUse;

    if (requiredMargin > availableBalance) {
      return NextResponse.json(
        { ok: false, message: `Insufficient balance. Available: ${availableBalance.toFixed(2)}` },
        { status: 400 }
      );
    }

    const newPosition = {
      id: `${currency}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      currency,
      side,
      orderType,
      leverage,
      amount,
      executionPrice,
      stopLoss,
      takeProfit,
      placedAt: new Date().toISOString(),
    };

    const nextPositions = [...positions, newPosition];
    await query(
      'UPDATE users SET positions_json = $1::jsonb WHERE id = $2',
      [JSON.stringify(nextPositions), userId]
    );

    return NextResponse.json({
      ok: true,
      wallet,
      positions: nextPositions,
      position: newPosition,
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Unable to open position.' },
      { status: 500 }
    );
  }
}
