export interface PercentileThresholds {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface Thresholds {
  yield: PercentileThresholds;
  price: PercentileThresholds;
  rent: PercentileThresholds;
  vacancy: PercentileThresholds;
  income: PercentileThresholds;
  growth: PercentileThresholds;
  tenantShare: PercentileThresholds;
  generatedAt: string;
  totalCommunes: number;
}
