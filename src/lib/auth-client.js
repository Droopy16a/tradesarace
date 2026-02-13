export const AUTH_USER_STORAGE_KEY = 'tradesarace_auth_user_v1';

export function loadStoredUser() {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const numericId = Number(parsed.id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;
    if (typeof parsed.name !== 'string') return null;
    if (typeof parsed.email !== 'string') return null;
    return {
      id: numericId,
      name: parsed.name,
      email: parsed.email,
    };
  } catch {
    return null;
  }
}

export function storeUser(user) {
  if (typeof window === 'undefined') return;
  const normalized = {
    id: Number(user?.id),
    name: String(user?.name || ''),
    email: String(user?.email || ''),
  };

  if (!Number.isFinite(normalized.id) || normalized.id <= 0) return;
  if (!normalized.name || !normalized.email) return;
  localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearStoredUser() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
}
