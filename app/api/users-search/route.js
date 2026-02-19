import { NextResponse } from 'next/server';
import { query } from '../../../src/lib/auth-db';
import { getSessionUserIdFromRequest } from '../../../src/lib/session';

export async function GET(request) {
  const userId = getSessionUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { ok: false, message: 'Unauthorized.' },
      { status: 401 }
    );
  }

  const q = String(request.nextUrl.searchParams.get('q') || '').trim();
  if (!q) {
    return NextResponse.json({ ok: true, users: [] });
  }

  try {
    const result = await query(
      `SELECT id, name, email
       FROM users
       WHERE id <> $1
         AND (name ILIKE $2 OR email ILIKE $2)
       ORDER BY name ASC
       LIMIT 8`,
      [userId, `%${q}%`]
    );

    const users = result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      email: row.email,
    }));

    return NextResponse.json({ ok: true, users });
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Unable to search users.' },
      { status: 500 }
    );
  }
}
