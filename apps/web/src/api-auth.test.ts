import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setApiAccessToken, setApiAuthRecovery } from "./api";

const stats = {
  totalQuotes: 1,
  totalLineItems: 2,
  catalogItemCount: 3,
  totalSuppliers: 4,
  dateRange: { from: null, to: null }
};

afterEach(() => {
  setApiAccessToken(null);
  setApiAuthRecovery(null);
});

describe("API authentication recovery", () => {
  it("refreshes a rejected token once and replays the request", async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined);
    setApiAccessToken("stale-token");
    setApiAuthRecovery({
      refresh: vi.fn().mockResolvedValue("fresh-token"),
      invalidate
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(stats), { status: 200 }));

    await expect(api.stats()).resolves.toEqual(stats);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const replayHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(replayHeaders.get("Authorization")).toBe("Bearer fresh-token");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates the session when Supabase cannot recover it", async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined);
    setApiAccessToken("invalid-token");
    setApiAuthRecovery({
      refresh: vi.fn().mockResolvedValue(null),
      invalidate
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "expired" }), { status: 401 })
    );

    await expect(api.stats()).rejects.toThrow("expired");
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
