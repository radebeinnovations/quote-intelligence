export const zar = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2
});

export const shortDate = new Intl.DateTimeFormat("en-ZA", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

export function formatDate(value: string): string {
  const normalized = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00`)
    : new Date(normalized);

  return Number.isNaN(date.getTime()) ? "Date unavailable" : shortDate.format(date);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-ZA").format(value);
}
