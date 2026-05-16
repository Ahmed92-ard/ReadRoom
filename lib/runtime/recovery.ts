'use client';

export const READROOM_STATE_VERSION = 5;
const VERSION_KEY = 'readroom:state-version';

const PRESERVED_KEYS = new Set([
  'theme',
]);

const READROOM_KEY_PREFIXES = [
  'readroom:',
  'readroom_',
  '__readroom_',
];

function isReadRoomKey(key: string) {
  return READROOM_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function ensureRuntimeStateVersion() {
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem(VERSION_KEY);
    const stored = Number.parseInt(raw ?? '0', 10);

    if (Number.isFinite(stored) && stored >= READROOM_STATE_VERSION) {
      return;
    }

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || PRESERVED_KEYS.has(key) || key === VERSION_KEY) continue;
      if (isReadRoomKey(key)) keysToRemove.push(key);
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(VERSION_KEY, String(READROOM_STATE_VERSION));
    console.warn('[runtime] reset stale ReadRoom local state', {
      from: Number.isFinite(stored) ? stored : raw,
      to: READROOM_STATE_VERSION,
      removed: keysToRemove.length,
    });
  } catch (err) {
    console.warn('[runtime] state version check failed', err);
  }
}

export function resetReadRoomRuntimeState() {
  if (typeof window === 'undefined') return;

  try {
    const theme = localStorage.getItem('theme');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && isReadRoomKey(key)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(VERSION_KEY, String(READROOM_STATE_VERSION));
    if (theme) localStorage.setItem('theme', theme);
  } catch (err) {
    console.warn('[runtime] local state reset failed', err);
  }

  try {
    sessionStorage.removeItem('__readroom_sw_reloaded__');
  } catch {}

  try {
    const dbApi = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    dbApi.databases?.()
      .then((databases) => {
        databases
          .map((db) => db.name)
          .filter((name): name is string => Boolean(name))
          .filter((name) => /readroom|pdf-reading-room/i.test(name))
          .forEach((name) => {
            console.warn('[runtime] deleting stale IndexedDB database', name);
            indexedDB.deleteDatabase(name);
          });
      })
      .catch((err) => console.warn('[runtime] IndexedDB scan failed', err));
  } catch (err) {
    console.warn('[runtime] IndexedDB reset failed', err);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHES' });
  }

  if ('caches' in window) {
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('readroom-')).map((key) => caches.delete(key))
      ))
      .catch((err) => console.warn('[runtime] cache reset failed', err));
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms = 12_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
