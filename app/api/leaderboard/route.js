import { NextResponse } from 'next/server';
import { query } from '../../../src/lib/auth-db';

function parseWallet(walletJson) {
  if (walletJson && typeof walletJson === 'object') return walletJson;
  try {
    return walletJson ? JSON.parse(walletJson) : null;
  } catch {
    return null;
  }
}

function getUsdBalance(wallet) {
  return typeof wallet?.usdBalance === 'number' ? wallet.usdBalance : 0;
}

// function maskEmail(email) {
//   const value = String(email || '');
//   const [name, domain] = value.split('@');
//   if (!name || !domain) return value;
//   if (name.length <= 2) return `${name[0] || '*'}*@${domain}`;
//   return `${name.slice(0, 2)}***@${domain}`;
// }

export async function GET(request) {
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), 25)
    : 10;

  try {
    const result = await query(
      'SELECT id, name, email, wallet_json FROM users'
    );
    const rows = result.rows;

    const sorted = rows
      .map((row) => {
        const wallet = parseWallet(row.wallet_json);
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          usdBalance: getUsdBalance(wallet),
        };
      })
      .sort((a, b) => b.usdBalance - a.usdBalance)
      .slice(0, limit)
      .map((entry, index) => ({
        rank: index + 1,
        id: entry.id,
        name: entry.name,
        // emailMasked: maskEmail(entry.email),
        usdBalance: entry.usdBalance,
      }));

    return NextResponse.json({ ok: true, leaderboard: sorted });
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Unable to load leaderboard.' },
      { status: 500 }
    );
  }
}
