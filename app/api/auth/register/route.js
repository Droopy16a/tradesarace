import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/auth-db';
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '../../../../src/lib/session';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const DEFAULT_WALLET = {
  usdBalance: 20000,
  btcBalance: 0.35,
  bonus: 185,
};

export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body?.name || '').trim();
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || '');

    if (!name || !email || !password) {
      return NextResponse.json(
        { ok: false, message: 'Name, email, and password are required.' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, message: 'Password must be at least 6 characters.' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const result = await query(
        `
          INSERT INTO users (name, email, password_hash, wallet_json, positions_json)
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
          RETURNING id, name, email
        `,
        [name, email, passwordHash, JSON.stringify(DEFAULT_WALLET), JSON.stringify([])]
      );

      const user = {
        id: Number(result.rows[0].id),
        name: result.rows[0].name,
        email: result.rows[0].email,
      };

      const response = NextResponse.json({
        ok: true,
        message: 'Registration successful.',
        user,
      });
      response.cookies.set(
        SESSION_COOKIE_NAME,
        createSessionToken(user.id),
        sessionCookieOptions()
      );
      return response;
    } catch (error) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { ok: false, message: 'An account with this email already exists.' },
          { status: 409 }
        );
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: 'Unable to register user.' },
      { status: 500 }
    );
  }
}
