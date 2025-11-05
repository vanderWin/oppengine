import type { ProjectionResults } from "./schema";

export interface ProphetForecastPoint {
  date: string;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
}

export interface ProphetForecastSeries {
  forecast: ProphetForecastPoint[];
  last_observed: string;
  forecast_end: string;
}

export interface ProphetForecastResponse {
  brand: ProphetForecastSeries;
  nonBrand: ProphetForecastSeries;
  monthsAhead: number;
  generatedAt: string;
}

export interface CombinedSessionsDatum {
  date: string;
  monthKey: string;
  actualSessions: number;
  scaledBrand: number;
  scaledNonBrand: number;
  isForecast: boolean;
}

export interface ScalingSummarySnapshot {
  quantifiableClicks: number;
  ninetyDaySessions: number;
  brandClicks: number;
  nonBrandClicks: number;
  gap: number;
  shortfallPercent: number;
  scaleFactor: number;
  isReady: boolean;
}

export interface ProphetStoredResults {
  forecast: ProphetForecastResponse | null;
  scalingSummary: ScalingSummarySnapshot;
  combinedSessions: CombinedSessionsDatum[];
}

export interface DashboardBootstrapPayload {
  prophet: ProphetStoredResults | null;
  uplift: ProjectionResults | null;
}
