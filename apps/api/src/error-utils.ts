export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const details = [record.message, record.details, record.hint].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    const code = typeof record.code === "string" ? `[${record.code}] ` : "";
    if (details.length) return `${code}${details.join(" ")}`;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}" && serialized !== '{"message":""}') {
        return serialized;
      }
      return "The database request failed without diagnostic details. Verify that all migrations are applied.";
    } catch {
      return "Unknown error";
    }
  }
  return String(error);
}

export function isDatabaseError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
  );
}
