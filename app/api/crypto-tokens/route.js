import { NextResponse } from 'next/server';

const TOKENS_ENDPOINT = 'https://price-api.crypto.com/meta/v2/all-tokens';

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-');
}

function pickFirstString(source, keys) {
  for (const key of keys) {
    const nextValue = source?.[key];
    if (typeof nextValue === 'string' && nextValue.trim()) {
      return nextValue.trim();
    }
  }
  return '';
}

function mapToken(rawToken) {
  const symbol = pickFirstString(rawToken, ['symbol', 'ticker', 'code']).toUpperCase();
  const name = pickFirstString(rawToken, ['name', 'full_name', 'token_name']);
  const rawId = pickFirstString(rawToken, ['slug', 'currency', 'id', 'token']);
  const id = normalizeId(rawId || name || symbol);

  if (!id || !symbol) return null;

  return {
    id,
    symbol,
    name: name || symbol,
    label: `${symbol}/USD`,
  };
}

function extractTokenList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.tokens)) return payload.tokens;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  if (Array.isArray(payload?.result?.tokens)) return payload.result.tokens;
  return [];
}

export async function GET() {
  try {
    const response = await fetch(TOKENS_ENDPOINT, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          tokens: [],
          message: `Token feed unavailable (${response.status})`,
        },
        { status: 200 }
      );
    }

    const payload = await response.json();
    const rawTokens = extractTokenList(payload);
    const deduped = new Map();

    rawTokens.forEach((rawToken) => {
      const token = mapToken(rawToken);
      if (!token) return;
      if (!deduped.has(token.id)) deduped.set(token.id, token);
    });

    const tokens = Array.from(deduped.values())
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    return NextResponse.json({ ok: true, tokens });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        tokens: [],
        message: 'Token feed request failed',
      },
      { status: 200 }
    );
  }
}
