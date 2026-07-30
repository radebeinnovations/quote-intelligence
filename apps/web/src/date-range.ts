import type { DateRangeQuery } from "@quote-intelligence/domain";

export const DATE_RANGE_OPTIONS = [
  { value: "30-days", label: "Last 30 Days", days: 30 },
  { value: "90-days", label: "Last 90 Days", days: 90 },
  { value: "180-days", label: "Last 180 Days", days: 180 },
  { value: "all-time", label: "All Time", days: null }
] as const;

export type DateRangePreset = (typeof DATE_RANGE_OPTIONS)[number]["value"];

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveDateRange(
  preset: DateRangePreset,
  today = new Date()
): DateRangeQuery {
  const option = DATE_RANGE_OPTIONS.find(({ value }) => value === preset);
  if (!option?.days) return {};

  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  from.setDate(from.getDate() - (option.days - 1));

  return {
    from: localIsoDate(from),
    to: localIsoDate(today)
  };
}
