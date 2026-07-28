import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import { CatalogBrowser } from "./components/CatalogBrowser";
import { CatalogDetailView } from "./components/CatalogDetailView";
import { StatCard } from "./components/StatCard";
import { UnmatchedItemsView } from "./components/UnmatchedItemsView";
import { formatDate, formatNumber } from "./format";

type Route =
  | { name: "catalog" }
  | { name: "detail"; catalogId: string }
  | { name: "review" };

function currentRoute(): Route {
  const catalogId = window.location.pathname.match(/^\/catalog\/([0-9a-f-]+)$/i)?.[1];
  if (catalogId) return { name: "detail", catalogId };
  if (window.location.pathname === "/review") return { name: "review" };
  return { name: "catalog" };
}

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [route, setRoute] = useState<Route>(currentRoute);
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
            className={route.name === "review" ? "active" : ""}
            onClick={() => navigate({ name: "review" })}
          >
            <span>↗</span> Review queue
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
          <button
            className="theme-toggle"
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "◐"}
          </button>
        </header>

        <div className="stats-strip">
          <StatCard label="Quotes" value={stats.data ? formatNumber(stats.data.totalQuotes) : "—"} hint="Current and historical" />
          <StatCard label="Suppliers" value={stats.data ? formatNumber(stats.data.totalSuppliers) : "—"} hint="South African vendors" />
          <StatCard label="Catalog services" value={stats.data ? formatNumber(stats.data.catalogItemCount) : "—"} hint="Canonical matches" />
          <StatCard label="Extracted lines" value={stats.data ? formatNumber(stats.data.totalLineItems) : "—"} hint="Auditable source records" />
        </div>

        <main className="content">
          {route.name === "detail" ? (
            <CatalogDetailView
              id={route.catalogId}
              onBack={() => navigate({ name: "catalog" })}
            />
          ) : route.name === "review" ? (
            <UnmatchedItemsView />
          ) : (
            <CatalogBrowser
              onSelect={(catalogId) => navigate({ name: "detail", catalogId })}
            />
          )}
        </main>
      </div>
    </div>
  );
}
