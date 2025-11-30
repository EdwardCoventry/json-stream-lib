// Lightweight persistent client session id for grouping requests per user/browser

const STORAGE_KEY = 'client_session_id_v1';

function safeGenerateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function canUseStorage(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const testKey = '__sess_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

let cachedId: string | null = null;

export function getClientSessionId(): string {
  if (cachedId) return cachedId;
  try {
    if (canUseStorage()) {
      const existing = window.localStorage.getItem(STORAGE_KEY);
      if (existing && existing.trim()) {
        cachedId = existing.trim();
        return cachedId;
      }
      const fresh = safeGenerateId();
      window.localStorage.setItem(STORAGE_KEY, fresh);
      cachedId = fresh;
      return cachedId;
    }
  } catch {}
  cachedId = safeGenerateId();
  return cachedId;
}

export function resetClientSessionId(): string {
  const fresh = safeGenerateId();
  cachedId = fresh;
  try {
    if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, fresh);
  } catch {}
  return fresh;
}

export default getClientSessionId;
