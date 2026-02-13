import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { query } from '../../../../src/lib/auth-db';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || '');

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, message: 'Email and password are required.' },
        { status: 400 }
      );
    }

    const result = await query(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [email]
    );
    const user = result.rows[0];

    if (!user) {
      return NextResponse.json(
        { ok: false, message: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return NextResponse.json(
        { ok: false, message: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'Login successful.',
      user: { id: Number(user.id), name: user.name, email: user.email },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: 'Unable to login user.' },
      { status: 500 }
    );
  }
}
