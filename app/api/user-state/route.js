import { NextResponse } from 'next/server';
import { query } from '../../../src/lib/auth-db';
import { getSessionUserIdFromRequest } from '../../../src/lib/session';

const DEFAULT_WALLET = {
  usdBalance: 20000,
  btcBalance: 0.35,
  bonus: 185,
};

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
  return NextResponse.json(
    { ok: false, message: 'Direct state updates are disabled. Use trade endpoints.' },
    { status: 405 }
  );
}
