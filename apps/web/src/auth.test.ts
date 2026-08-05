import type { Session, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { resolveVerifiedSession } from "./auth";

const user = { id: "11111111-1111-4111-8111-111111111111" } as User;

function session(accessToken: string): Session {
  return {
    access_token: accessToken,
    refresh_token: `${accessToken}-refresh`,
    expires_in: 3600,
    token_type: "bearer",
    user
  } as Session;
}

type SessionAuthClient = Parameters<typeof resolveVerifiedSession>[0];

function authClient(overrides: Partial<SessionAuthClient> = {}): SessionAuthClient {
  return {
    getSession: vi.fn(),
    getUser: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(),
    ...overrides
  } as SessionAuthClient;
}

describe("persisted Supabase session recovery", () => {
  it("keeps a persisted session only after Supabase validates its user", async () => {
    const stored = session("valid-token");
    const auth = authClient({
      getSession: vi.fn().mockResolvedValue({ data: { session: stored }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null })
    });

    await expect(resolveVerifiedSession(auth)).resolves.toBe(stored);
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("replaces an invalid access token when its refresh token is valid", async () => {
    const stored = session("stale-token");
    const refreshed = session("refreshed-token");
    const auth = authClient({
      getSession: vi.fn().mockResolvedValue({ data: { session: stored }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("invalid") }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: refreshed, user },
        error: null
      })
    });

    await expect(resolveVerifiedSession(auth)).resolves.toBe(refreshed);
    expect(auth.refreshSession).toHaveBeenCalledWith(stored);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("clears an irrecoverable persisted session instead of rendering an authenticated app", async () => {
    const stored = session("invalid-token");
    const auth = authClient({
      getSession: vi.fn().mockResolvedValue({ data: { session: stored }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("invalid") }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: new Error("refresh failed")
      }),
      signOut: vi.fn().mockResolvedValue({ error: null })
    });

    await expect(resolveVerifiedSession(auth)).resolves.toBeNull();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
