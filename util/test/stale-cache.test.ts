import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStaleWhileRevalidate } from "../../src/lib/stale-cache";

let keyCounter = 0;
function newKey(label: string): string {
  keyCounter += 1;
  return `vitest:${label}:${keyCounter}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubEnv("ORBIT_CACHE_TTL_SECONDS", "3600");
  vi.stubEnv("ORBIT_REQUEST_GAP_MS", "0");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getStaleWhileRevalidate", () => {
  it("returns MISS and stores the first successful value", async () => {
    const key = newKey("miss");
    const result = await getStaleWhileRevalidate(
      key,
      async () => ({ body: "earth", count: 1 }),
      { queue: false },
    );

    expect(result.status).toBe("MISS");
    expect(result.value).toEqual({ body: "earth", count: 1 });
    expect(result.expiresAt).toBeGreaterThan(result.fetchedAt);
  });

  it("returns a fresh HIT without calling the loader again", async () => {
    const key = newKey("hit");
    const loader = vi.fn(async () => "cached result");

    const first = await getStaleWhileRevalidate(key, loader, { queue: false });
    const second = await getStaleWhileRevalidate(key, loader, { queue: false });

    expect(first.status).toBe("MISS");
    expect(second.status).toBe("HIT");
    expect(second.value).toBe("cached result");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent cache misses for the same key", async () => {
    const key = newKey("deduplicate");
    const gate = deferred<string>();
    const loader = vi.fn(() => gate.promise);

    const firstRequest = getStaleWhileRevalidate(key, loader, { queue: false });
    const secondRequest = getStaleWhileRevalidate(key, loader, { queue: false });

    expect(loader).toHaveBeenCalledTimes(1);
    gate.resolve("one fetch for both requests");

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.value).toBe("one fetch for both requests");
    expect(second.value).toBe("one fetch for both requests");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns stale data immediately while a refresh is pending", async () => {
    const key = newKey("stale");
    await getStaleWhileRevalidate(key, async () => "old", { queue: false });

    vi.stubEnv("ORBIT_CACHE_TTL_SECONDS", "0");

    const gate = deferred<string>();
    const refresh = vi.fn(() => gate.promise);
    const staleResult = await getStaleWhileRevalidate(key, refresh, { queue: false });

    expect(staleResult.status).toBe("STALE");
    expect(staleResult.value).toBe("old");
    expect(refresh).toHaveBeenCalledTimes(1);

    gate.resolve("new");
    await gate.promise;
    vi.stubEnv("ORBIT_CACHE_TTL_SECONDS", "3600");
    await vi.waitFor(async () => {
      const updated = await getStaleWhileRevalidate(key, async () => "unexpected", { queue: false });
      expect(updated.value).toBe("new");
      expect(updated.status).toBe("HIT");
    });
  });

  it("keeps the last good value when a background refresh fails", async () => {
    const key = newKey("failed-refresh");
    await getStaleWhileRevalidate(key, async () => "last good value", { queue: false });

    vi.stubEnv("ORBIT_CACHE_TTL_SECONDS", "0");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const staleResult = await getStaleWhileRevalidate(
      key,
      async () => {
        throw new Error("upstream unavailable");
      },
      { queue: false },
    );

    expect(staleResult.value).toBe("last good value");
    expect(staleResult.status).toBe("STALE");

    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });
    const stillCached = await getStaleWhileRevalidate(key, async () => "wrong", { queue: false });
    expect(stillCached.value).toBe("last good value");
  });

  it("treats entries as stale when the configured TTL is zero", async () => {
    const key = newKey("zero-ttl");
    await getStaleWhileRevalidate(key, async () => "stored", { queue: false });
    vi.stubEnv("ORBIT_CACHE_TTL_SECONDS", "0");

    const result = await getStaleWhileRevalidate(key, async () => "refreshed", { queue: false });
    expect(result.status).toBe("STALE");
    expect(result.value).toBe("stored");
  });

  it("does not cache a failed initial load", async () => {
    const key = newKey("failed-miss");

    await expect(
      getStaleWhileRevalidate(key, async () => {
        throw new Error("initial request failed");
      }, { queue: false }),
    ).rejects.toThrow("initial request failed");

    const recovered = await getStaleWhileRevalidate(key, async () => "recovered", { queue: false });
    expect(recovered.status).toBe("MISS");
    expect(recovered.value).toBe("recovered");
  });


  it("serialises initial fetches across keys when the shared queue is enabled", async () => {
    const firstKey = newKey("queued-first");
    const secondKey = newKey("queued-second");
    const firstGate = deferred<string>();
    const firstLoader = vi.fn(() => firstGate.promise);
    const secondLoader = vi.fn(async () => "second value");

    const firstRequest = getStaleWhileRevalidate(firstKey, firstLoader);
    const secondRequest = getStaleWhileRevalidate(secondKey, secondLoader);

    await Promise.resolve();
    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(secondLoader).not.toHaveBeenCalled();

    firstGate.resolve("first value");
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(first.value).toBe("first value");
    expect(second.value).toBe("second value");
    expect(secondLoader).toHaveBeenCalledTimes(1);
  });

  it("does not serialize different-key fetches when queue:false is requested", async () => {
    const firstKey = newKey("parallel-first");
    const secondKey = newKey("parallel-second");
    const firstGate = deferred<string>();
    const secondGate = deferred<string>();
    const firstLoader = vi.fn(() => firstGate.promise);
    const secondLoader = vi.fn(() => secondGate.promise);

    const firstRequest = getStaleWhileRevalidate(firstKey, firstLoader, { queue: false });
    const secondRequest = getStaleWhileRevalidate(secondKey, secondLoader, { queue: false });

    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(secondLoader).toHaveBeenCalledTimes(1);
    firstGate.resolve("first");
    secondGate.resolve("second");
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toHaveLength(2);
  });

  it("allows a fresh cache hit to return while another key's fetch is pending", async () => {
    const cachedKey = newKey("parallel-hit");
    const pendingKey = newKey("pending-miss");
    await getStaleWhileRevalidate(cachedKey, async () => "already cached", { queue: false });

    const gate = deferred<string>();
    const pending = getStaleWhileRevalidate(pendingKey, () => gate.promise);
    const hit = await getStaleWhileRevalidate(cachedKey, async () => "should not run", { queue: false });

    expect(hit.status).toBe("HIT");
    expect(hit.value).toBe("already cached");
    gate.resolve("freshly fetched");
    await pending;
  });
});
