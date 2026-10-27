type CacheStatus = "MISS" | "HIT" | "STALE";

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

export interface CachedResult<T> {
  value: T;
  status: CacheStatus;
  fetchedAt: number;
  expiresAt: number;
}

export interface CacheOptions {
  /**
   * Use the shared fetch queue. Set false only when the loader manages its own
   * upstream request queue or calls other cached loaders internally.
   */
  queue?: boolean;
}

const DEFAULT_TTL_SECONDS = 60 * 60;
const DEFAULT_REQUEST_GAP_MS = 250;

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

// Only upstream fetches enter this queue. Returning cached data never does.
let requestQueue: Promise<void> = Promise.resolve();

function getTtlMs(): number {
  const raw = process.env.ORBIT_CACHE_TTL_SECONDS;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TTL_SECONDS * 1000;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_TTL_SECONDS * 1000;
  }

  return seconds * 1000;
}

function getRequestGapMs(): number {
  const raw = process.env.ORBIT_REQUEST_GAP_MS;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_REQUEST_GAP_MS;
  }

  const milliseconds = Number(raw);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return DEFAULT_REQUEST_GAP_MS;
  }

  return milliseconds;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Serializes upstream API calls, not reads from the cache. */
function enqueueRequest<T>(loader: () => Promise<T>): Promise<T> {
  const result = requestQueue.then(async () => {
    try {
      return await loader();
    } finally {
      await sleep(getRequestGapMs());
    }
  });

  // Keep the queue usable if an upstream request fails.
  requestQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}

/** Fetches one key at a time, deduplicating simultaneous refreshes for that key. */
function fetchAndStore<T>(
  key: string,
  loader: () => Promise<T>,
  useSharedQueue: boolean,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const job = (async () => {
    try {
      const value = useSharedQueue
        ? await enqueueRequest(loader)
        : await loader();

      cache.set(key, { value, fetchedAt: Date.now() });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}

export async function getStaleWhileRevalidate<T>(
  key: string,
  loader: () => Promise<T>,
  options: CacheOptions = {},
): Promise<CachedResult<T>> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  const ttlMs = getTtlMs();
  const useSharedQueue = options.queue !== false;

  // FAST PATH: fresh cache hits return immediately. They never wait on
  // the upstream request queue, and different cache hits can run together.
  if (entry && Date.now() - entry.fetchedAt < ttlMs) {
    return {
      value: entry.value,
      status: "HIT",
      fetchedAt: entry.fetchedAt,
      expiresAt: entry.fetchedAt + ttlMs,
    };
  }

  // STALE PATH: return the saved value immediately, while a single
  // throttled background refresh updates the cache for the next request.
  if (entry) {
    void fetchAndStore(key, loader, useSharedQueue).catch((error: unknown) => {
      console.error(`[Data cache] Background refresh failed for "${key}"`, error);
    });

    return {
      value: entry.value,
      status: "STALE",
      fetchedAt: entry.fetchedAt,
      expiresAt: entry.fetchedAt + ttlMs,
    };
  }

  // MISS PATH: no saved value exists, so the caller must wait for the
  // first successful fetch. Only this upstream fetch is throttled.
  const value = await fetchAndStore(key, loader, useSharedQueue);
  const stored = cache.get(key) as CacheEntry<T>;

  return {
    value,
    status: "MISS",
    fetchedAt: stored.fetchedAt,
    expiresAt: stored.fetchedAt + getTtlMs(),
  };
}
