export interface PriceObservation {
  rate: number;
  observedAt: Date;
  supplierId: string;
}

export interface FairPriceResult {
  fairPrice: number | null;
  overallMedian: number | null;
  recentMedian: number | null;
  mean: number | null;
  minimum: number | null;
  maximum: number | null;
  sampleSize: number;
  supplierCount: number;
  method: "no-data" | "median" | "weighted-median";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

export function calculateFairPrice(
  observations: PriceObservation[],
  asOf: Date
): FairPriceResult {
  const rates = observations.map(({ rate }) => rate);
  const recentBoundary = new Date(asOf);
  recentBoundary.setUTCDate(recentBoundary.getUTCDate() - 180);
  const recentRates = observations
    .filter(({ observedAt }) => observedAt >= recentBoundary && observedAt <= asOf)
    .map(({ rate }) => rate);
  const overallMedian = median(rates);
  const recentMedian = median(recentRates);

  let fairPrice: number | null = overallMedian;
  let method: FairPriceResult["method"] = observations.length ? "median" : "no-data";

  if (overallMedian !== null && recentMedian !== null && recentRates.length >= 3) {
    fairPrice = overallMedian * 0.7 + recentMedian * 0.3;
    method = "weighted-median";
  }

  return {
    fairPrice,
    overallMedian,
    recentMedian,
    mean: rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null,
    minimum: rates.length ? Math.min(...rates) : null,
    maximum: rates.length ? Math.max(...rates) : null,
    sampleSize: observations.length,
    supplierCount: new Set(observations.map(({ supplierId }) => supplierId)).size,
    method
  };
}

