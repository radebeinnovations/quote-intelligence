import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode
} from "react";
import { api } from "./api";
import { CatalogBrowser } from "./components/CatalogBrowser";
import { CatalogDetailView } from "./components/CatalogDetailView";
import { IngestionAuditView } from "./components/IngestionAuditView";
import { StatCard } from "./components/StatCard";
import { SupplierListView } from "./components/SupplierListView";
import { SupplierProfileView } from "./components/SupplierProfileView";
import { UploadQuoteModal } from "./components/UploadQuoteModal";
import { UnmatchedItemsView } from "./components/UnmatchedItemsView";
import { formatDate, formatNumber } from "./format";
import { useAuth } from "./auth";

type Route =
  | { name: "catalog" }
  | { name: "detail"; catalogId: string; variantIds: string[] }
  | { name: "review" }
  | { name: "suppliers" }
  | { name: "supplier-detail"; supplierId: string }
  | { name: "audit" };

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "quote-intelligence-theme";

function initialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function currentRoute(): Route {
  const catalogId = window.location.pathname.match(/^\/catalog\/([0-9a-f-]+)$/i)?.[1];
  const supplierId = window.location.pathname.match(/^\/suppliers\/([0-9a-f-]+)$/i)?.[1];
  if (catalogId) {
    const variantIds = new URLSearchParams(window.location.search)
      .get("variants")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
    return { name: "detail", catalogId, variantIds };
  }
  if (supplierId) return { name: "supplier-detail", supplierId };
  if (window.location.pathname === "/review") return { name: "review" };
  if (window.location.pathname === "/suppliers") return { name: "suppliers" };
  if (window.location.pathname === "/audit") return { name: "audit" };
  return { name: "catalog" };
}

export function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Quote Intelligence failed to render.", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div className="error-state">
          <p className="eyebrow">Application error</p>
          <strong>Quote Intelligence could not display this page.</strong>
          <p>{this.state.error.message || "An unexpected rendering error occurred."}</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </div>
      </main>
    );
  }
}

function AppContent() {
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [route, setRoute] = useState<Route>(currentRoute);
  const [uploadOpen, setUploadOpen] = useState(false);
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The visual theme still applies when persistence is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextRoute: Route) {
    const path =
      nextRoute.name === "detail"
        ? `/catalog/${nextRoute.catalogId}${
            nextRoute.variantIds.length
              ? `?variants=${encodeURIComponent(nextRoute.variantIds.join(","))}`
              : ""
          }`
        : nextRoute.name === "supplier-detail"
        ? `/suppliers/${nextRoute.supplierId}`
        : nextRoute.name === "review"
        ? "/review"
        : nextRoute.name === "suppliers"
        ? "/suppliers"
        : nextRoute.name === "audit"
        ? "/audit"
        : "/";
    window.history.pushState({}, "", path);
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const dateRange =
    stats.data?.dateRange.from && stats.data.dateRange.to
      ? `${formatDate(stats.data.dateRange.from)} – ${formatDate(stats.data.dateRange.to)}`
      : "Awaiting ingestion";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate({ name: "catalog" })}>
          <span className="brand-mark">BQ</span>
          <span><strong>Bokmakierie</strong><small>Quote Intelligence</small></span>
        </button>
        <nav>
          <button
            className={route.name === "catalog" ? "active" : ""}
            onClick={() => navigate({ name: "catalog" })}
          >
            <span>⌘</span> Catalog
          </button>
          <button
            className={route.name === "suppliers" || route.name === "supplier-detail" ? "active" : ""}
            onClick={() => navigate({ name: "suppliers" })}
          >
            <span>📊</span> Suppliers
          </button>
          <button
            className={route.name === "review" ? "active" : ""}
            onClick={() => navigate({ name: "review" })}
          >
            <span>↗</span> Review queue
          </button>
          <button
            className={route.name === "audit" ? "active" : ""}
            onClick={() => navigate({ name: "audit" })}
          >
            <span>📜</span> Ingestion Audit
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" />
          <div><strong>Analytics basis</strong><small>ZAR · Ex VAT · SA dates</small></div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div><p>Procurement workspace</p><span>{dateRange}</span></div>
          <div className="topbar-actions">
            <button className="button primary compact" onClick={() => setUploadOpen(true)}>
              + Upload quotes
            </button>
            <span className="user-email" title={user.email}>{user.email}</span>
            <button className="button secondary compact" onClick={() => void signOut()}>
              Sign out
            </button>
            <button
              className="theme-toggle"
              onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? "☀" : "◐"}
            </button>
          </div>
        </header>

        <div className="stats-strip">
          <StatCard label="Quotes" value={stats.data ? formatNumber(stats.data.totalQuotes) : "—"} hint="Current and historical" />
          <StatCard label="Suppliers" value={stats.data ? formatNumber(stats.data.totalSuppliers) : "—"} hint="South African vendors" />
          <StatCard label="Catalog services" value={stats.data ? formatNumber(stats.data.catalogItemCount) : "—"} hint="Canonical matches" />
          <StatCard label="Extracted lines" value={stats.data ? formatNumber(stats.data.totalLineItems) : "—"} hint="Auditable source records" />
        </div>
        {stats.isError && (
          <div className="stats-error" role="alert">
            <span>Live metrics are unavailable: {stats.error.message}</span>
            <button className="button secondary compact" onClick={() => void stats.refetch()}>
              Retry
            </button>
          </div>
        )}

        <main className="content">
          {route.name === "detail" ? (
            <CatalogDetailView
              key={`${route.catalogId}:${route.variantIds.join(",")}`}
              id={route.catalogId}
              initialVariantIds={route.variantIds}
              onBack={() => navigate({ name: "catalog" })}
            />
          ) : route.name === "review" ? (
            <UnmatchedItemsView />
          ) : route.name === "supplier-detail" ? (
            <SupplierProfileView
              id={route.supplierId}
              onBack={() => navigate({ name: "suppliers" })}
            />
          ) : route.name === "suppliers" ? (
            <SupplierListView
              onSelect={(supplierId) => navigate({ name: "supplier-detail", supplierId })}
            />
          ) : route.name === "audit" ? (
            <IngestionAuditView />
          ) : (
            <CatalogBrowser
              onSelect={(catalogId, variantIds = []) =>
                navigate({ name: "detail", catalogId, variantIds })
              }
              onUpload={() => setUploadOpen(true)}
            />
          )}
        </main>
      </div>
      {uploadOpen && (
        <UploadQuoteModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            void queryClient.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}
