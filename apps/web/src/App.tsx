import { useQuery } from "@tanstack/react-query";
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
import { UnmatchedItemsView } from "./components/UnmatchedItemsView";
import { UploadQuoteModal } from "./components/UploadQuoteModal";
import { formatDate, formatNumber } from "./format";

type Route =
  | { name: "catalog" }
  | { name: "detail"; catalogId: string }
  | { name: "review" }
  | { name: "suppliers" }
  | { name: "audit" };

function currentRoute(): Route {
  const catalogId = window.location.pathname.match(/^\/catalog\/([0-9a-f-]+)$/i)?.[1];
  if (catalogId) return { name: "detail", catalogId };
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

interface AppErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Quote Intelligence failed to render.", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error" role="alert">
          <div className="error-state">
            <p className="eyebrow">Application error</p>
            <strong>Quote Intelligence could not display this page.</strong>
            <p>{this.state.error.message || "An unexpected rendering error occurred."}</p>
            <button
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Reload application
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [route, setRoute] = useState<Route>(currentRoute);
  const [uploadOpen, setUploadOpen] = useState(false);
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextRoute: Route) {
    const path =
      nextRoute.name === "detail"
        ? `/catalog/${nextRoute.catalogId}`
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
            <span>⌘</span><span className="nav-label">Catalog</span>
          </button>
          <button
            className={route.name === "suppliers" ? "active" : ""}
            onClick={() => navigate({ name: "suppliers" })}
          >
            <span>▥</span><span className="nav-label">Suppliers</span>
          </button>
          <button
            className={route.name === "review" ? "active" : ""}
            onClick={() => navigate({ name: "review" })}
          >
            <span>↗</span><span className="nav-label">Review queue</span>
          </button>
          <button
            className={route.name === "audit" ? "active" : ""}
            onClick={() => navigate({ name: "audit" })}
          >
            <span>▤</span><span className="nav-label">Ingestion Audit</span>
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
            <button className="button upload-quote-button" onClick={() => setUploadOpen(true)}>
              ↑ Upload Quote PDF
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

        <div className="stats-strip" aria-busy={stats.isLoading}>
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
              id={route.catalogId}
              onBack={() => navigate({ name: "catalog" })}
            />
          ) : route.name === "review" ? (
            <UnmatchedItemsView />
          ) : route.name === "suppliers" ? (
            <SupplierListView />
          ) : route.name === "audit" ? (
            <IngestionAuditView />
          ) : (
            <CatalogBrowser
              onSelect={(catalogId) => navigate({ name: "detail", catalogId })}
            />
          )}
        </main>
      </div>
      {uploadOpen && <UploadQuoteModal onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
