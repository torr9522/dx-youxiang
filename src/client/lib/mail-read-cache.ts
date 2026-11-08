const MAX_ENTRIES = 96;
const FRESH_TTL_MS = 10_000;
const MAX_STALE_MS = 5 * 60_000;

type CacheEntry = {
  value: unknown;
  updatedAt: number;
};

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
let generation = 0;
let role = "guest";
let cacheVersion = 0;

export type MailReadCacheHit<T> = {
  value: T;
  updatedAt: number;
  fresh: boolean;
};

export function beginMailReadSession(nextRole: "admin" | "mailbox_user") {
  generation += 1;
  cacheVersion += 1;
  role = nextRole;
  entries.clear();
  inFlight.clear();
}

export function clearMailReadCache() {
  generation += 1;
  cacheVersion += 1;
  role = "guest";
  entries.clear();
  inFlight.clear();
}

export function mailReadKey(kind: "list" | "detail" | "folders", parts: Array<string | number>) {
  return `${generation}:${role}:${kind}:${parts.map((part) => encodeURIComponent(String(part))).join(":")}`;
}

export function getMailReadCache<T>(key: string): MailReadCacheHit<T> | null {
  const entry = entries.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.updatedAt;
  if (age > MAX_STALE_MS) {
    entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return { value: entry.value as T, updatedAt: entry.updatedAt, fresh: age <= FRESH_TTL_MS };
}

export function fetchMailRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const requestVersion = cacheVersion;
  const request = loader().then((value) => {
    if (requestVersion === cacheVersion) {
      entries.delete(key);
      entries.set(key, { value, updatedAt: Date.now() });
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    }
    return value;
  }).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export function invalidateMailboxReadCache(mailboxId: number) {
  cacheVersion += 1;
  const encodedMailboxId = encodeURIComponent(String(mailboxId));
  const belongsToMailbox = (key: string) => key.split(":")[3] === encodedMailboxId;
  for (const key of entries.keys()) {
    if (belongsToMailbox(key)) entries.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (belongsToMailbox(key)) inFlight.delete(key);
  }
}

export function mailReadCacheInfo() {
  return { capacity: MAX_ENTRIES, freshTtlMs: FRESH_TTL_MS, maxStaleMs: MAX_STALE_MS, size: entries.size, inFlight: inFlight.size };
}
