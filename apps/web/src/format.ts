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
  return shortDate.format(new Date(`${value}T00:00:00`));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-ZA").format(value);
}

