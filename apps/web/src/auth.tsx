import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import { setApiAccessToken } from "./api";
import { browserSupabase } from "./supabase";

interface AuthContextValue {
  user: User;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthGate.");
  return context;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!browserSupabase) {
      setLoading(false);
      return;
    }
    void browserSupabase.auth.getSession().then(({ data }) => {
      userIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      setApiAccessToken(data.session?.access_token ?? null);
      setLoading(false);
    });
    const { data } = browserSupabase.auth.onAuthStateChange((_event, next) => {
      const nextUserId = next?.user.id ?? null;
      if (userIdRef.current !== nextUserId) queryClient.clear();
      userIdRef.current = nextUserId;
      setSession(next);
      setApiAccessToken(next?.access_token ?? null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const context = useMemo<AuthContextValue | null>(
    () =>
      session
        ? {
            user: session.user,
            signOut: async () => {
              queryClient.clear();
              setApiAccessToken(null);
              await browserSupabase?.auth.signOut();
            }
          }
        : null,
    [queryClient, session]
  );

  if (!browserSupabase) return <AuthConfigurationState />;
  if (loading) {
    return <div className="auth-loading" role="status">Securing your workspace…</div>;
  }
  if (!session || !context) return <AuthForm />;
  return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;
}

function AuthConfigurationState() {
  return (
    <main className="auth-shell">
      <section className="auth-card panel">
        <span className="brand-mark">BQ</span>
        <p className="eyebrow">Configuration required</p>
        <h1>Connect Supabase Auth</h1>
        <p>
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>
          to the root environment file, then restart the web application.
        </p>
      </section>
    </main>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!browserSupabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "login") {
        const { error: authError } = await browserSupabase.auth.signInWithPassword({
          email,
          password
        });
        if (authError) throw authError;
      } else {
        const { data, error: authError } = await browserSupabase.auth.signUp({
          email,
          password
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage("Check your email to confirm the account, then sign in.");
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark">BQ</span>
          <div><strong>Bokmakierie</strong><small>Quote Intelligence</small></div>
        </div>
        <p className="eyebrow">Private procurement workspace</p>
        <h1 id="auth-title">
          {mode === "login" ? "Welcome back" : "Create your workspace"}
        </h1>
        <p>
          {mode === "login"
            ? "Sign in to access your isolated supplier and quote intelligence."
            : "New accounts start with an empty, private procurement catalog."}
        </p>
        <div className="segmented-control auth-tabs" aria-label="Authentication mode">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            aria-pressed={mode === "login"}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            aria-pressed={mode === "register"}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-success" role="status">{message}</p>}
          <button className="button primary auth-submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}
