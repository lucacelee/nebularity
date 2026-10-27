import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSolarBody } from "../../src/lib/solar-system-data";

beforeEach(() => {
  vi.stubEnv("NB_LE_SYSTEME_SOLAIR_API_KEY", "test-api-key");
  vi.stubEnv("ORBIT_REQUEST_GAP_MS", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getSolarBody API integration", () => {
  it("fetches one body's fields with the server-side API key", async () => {
    const responseBody = {
      id: "vitest-body-success",
      name: "Vitest Test Body",
      englishName: "Vitest Test Body",
      bodyType: "Test object",
    };
    const fetchSpy = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json(responseBody));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getSolarBody("vitest-body-success");

    expect(result.status).toBe("MISS");
    expect(result.value).toEqual(responseBody);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [input, init] = fetchSpy.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toContain("/bodies/vitest-body-success");
    expect(url.searchParams.get("data")).toContain("mass");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-api-key",
      Accept: "application/json",
    });
  });

  it("propagates a useful upstream error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ message: "provider under maintenance" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )));

    await expect(getSolarBody("vitest-body-failure"))
      .rejects.toThrow("provider under maintenance");
  });

  it("rejects empty server API keys rather than sending an unauthenticated request", async () => {
    vi.stubEnv("NB_LE_SYSTEME_SOLAIR_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getSolarBody("vitest-body-no-key"))
      .rejects.toThrow("NB_LE_SYSTEME_SOLAIR_API_KEY is missing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
