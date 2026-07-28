const monthNames = new Map<string, number>();
[
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
].forEach((month, index) => {
  monthNames.set(month, index + 1);
  monthNames.set(month.slice(0, 3), index + 1);
});
monthNames.set("sept", 9);

function isoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function parseSouthAfricanDate(input: string): string {
  const value = input.trim();
  const numeric = value.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (numeric) {
    const [, first, second, third] = numeric;
    if (!first || !second || !third) throw new Error(`Invalid date: ${input}`);
    if (first.length === 4) return isoDate(Number(first), Number(second), Number(third));
    return isoDate(Number(third), Number(second), Number(first));
  }

  const words = value.match(
    /^(\d{1,2})(?:st|nd|rd|th)?[\s/-]+([A-Za-z]+)[,\s/-]+(\d{4})$/i
  );
  if (words) {
    const [, day, monthText, year] = words;
    const month = monthNames.get((monthText ?? "").toLowerCase());
    if (!day || !month || !year) throw new Error(`Invalid date: ${input}`);
    return isoDate(Number(year), month, Number(day));
  }

  throw new Error(`Unsupported South African date format: ${input}`);
}
