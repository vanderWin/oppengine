// OppEngine Database Schema
// Currently using session-based storage only (no persistence)
// Future: Add tables for storing analysis results if needed

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === Uplift Calculator Types ===

export const DifficultyLevel = z.enum(["Easy", "Medium", "Hard", "Top10", "N/A"]);
export type DifficultyLevel = z.infer<typeof DifficultyLevel>;

export const ProjectionMode = z.enum(["Average", "Seasonal"]);
export type ProjectionMode = z.infer<typeof ProjectionMode>;

// Column mapping configuration
export const ColumnMappingSchema = z.object({
  keyword: z.string(),
  volume: z.string(),
  difficulty: z.string().nullable(),
  startRank: z.string().nullable(),
  intent: z.string().nullable(),
  category: z.string().nullable(),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

// Projection horizon settings
export const ProjectionHorizonSchema = z.object({
  monthsAhead: z.number().int().min(1).max(36).default(12),
  startDate: z.string(), // ISO date string
  mode: ProjectionMode.default("Seasonal"),
});
export type ProjectionHorizon = z.infer<typeof ProjectionHorizonSchema>;

// Rank caps by difficulty (null = no cap)
export const RankCapsSchema = z.object({
  Easy: z.number().int().min(1).max(20).nullable().default(null),
  Medium: z.number().int().min(1).max(20).nullable().default(2),
  Hard: z.number().int().min(1).max(20).nullable().default(3),
  Top10: z.number().int().min(1).max(20).nullable().default(null),
  "N/A": z.number().int().min(1).max(20).nullable().default(2),
});
export type RankCaps = z.infer<typeof RankCapsSchema>;

// Phase durations for rank progression
export const PhaseDurationsSchema = z.object({
  T1: z.number().positive().default(1.0), // 100 → 50
  T2: z.number().positive().default(2.0), // 50 → 20
  T3: z.number().positive().default(3.0), // 20 → 10
  T4: z.number().positive().default(6.0), // 10 → 1
  k: z.number().positive().default(3.5),  // Curve steepness
});
export type PhaseDurations = z.infer<typeof PhaseDurationsSchema>;

// Difficulty multipliers
export const DifficultyMultipliersSchema = z.object({
  Easy: z.number().positive().default(0.6),
  Medium: z.number().positive().default(1.0),
  Hard: z.number().positive().default(1.6),
  Top10: z.number().positive().default(2.2),
  "N/A": z.number().positive().default(1.0),
});
export type DifficultyMultipliers = z.infer<typeof DifficultyMultipliersSchema>;

// Volume multiplier settings
export const VolumeMultiplierSchema = z.object({
  vMin: z.number().default(0.8),
  vSpan: z.number().default(0.7),
  mMin: z.number().default(0.8),
  mMax: z.number().default(1.5),
  volMaxMode: z.enum(["auto", "manual"]).default("auto"),
  volMaxManual: z.number().int().positive().default(100000),
});
export type VolumeMultiplier = z.infer<typeof VolumeMultiplierSchema>;

// Complete uplift parameters
export const UpliftParametersSchema = z.object({
  columnMapping: ColumnMappingSchema,
  projectionHorizon: ProjectionHorizonSchema,
  rankCaps: RankCapsSchema,
  phaseDurations: PhaseDurationsSchema,
  difficultyMultipliers: DifficultyMultipliersSchema,
  volumeMultiplier: VolumeMultiplierSchema,
  ctrValues: z.array(z.number().min(0).max(1)).length(20), // CTR for positions 1-20
});
export type UpliftParameters = z.infer<typeof UpliftParametersSchema>;

// Keyword data from uploaded CSV
export const KeywordRowSchema = z.object({
  keyword: z.string(),
  volume: z.number().min(0).default(0), // Accept decimals, not just integers
  difficulty: z.string().default("N/A"),
  startRank: z.number().min(1).default(100), // Remove max constraint for flexibility
  intent: z.string().optional(),
  category: z.string().optional(),
});
export type KeywordRow = z.infer<typeof KeywordRowSchema>;

// Projection result for a single keyword at a single month
export const ProjectionRowSchema = z.object({
  keyword: z.string(),
  volume: z.number(), // Accept decimals, not just integers
  difficulty: z.string(),
  startRank: z.number(),
  category: z.string().optional(),
  mainCategory: z.string().optional(),
  intent: z.string().optional(),
  monthAhead: z.number().int(),
  monthStart: z.string(), // ISO date string
  predRank: z.number(),
  expCtr: z.number(),
  expVisits: z.number(),
  baselineVisits: z.number(),
  expUplift: z.number(),
  quickWin: z.boolean(),
  opportunityScore: z.number().min(0).max(10),
});
export type ProjectionRow = z.infer<typeof ProjectionRowSchema>;

// Aggregated results by month
export const MonthlyAggregateSchema = z.object({
  monthStart: z.string(), // ISO date string
  totalUplift: z.number(),
  totalVisits: z.number(),
  totalBaseline: z.number(),
});
export type MonthlyAggregate = z.infer<typeof MonthlyAggregateSchema>;

// Category/Intent breakdown by month
export const CategoryUpliftSchema = z.object({
  monthStart: z.string(),
  category: z.string(),
  uplift: z.number(),
});
export type CategoryUplift = z.infer<typeof CategoryUpliftSchema>;

export const IntentUpliftSchema = z.object({
  monthStart: z.string(),
  intent: z.string(),
  uplift: z.number(),
});
export type IntentUplift = z.infer<typeof IntentUpliftSchema>;

// Debug info for seasonal volumes
export const SeasonalVolumeDebugSchema = z.object({
  keyword: z.string(),
  monthlyVolumes: z.array(z.number()),
  source: z.enum(["cache", "fallback"]),
});
export type SeasonalVolumeDebug = z.infer<typeof SeasonalVolumeDebugSchema>;

// Complete projection results
export const ProjectionResultsSchema = z.object({
  detailedProjections: z.array(ProjectionRowSchema),
  monthlyAggregates: z.array(MonthlyAggregateSchema),
  categoryUpliftByMonth: z.array(CategoryUpliftSchema),
  intentUpliftByMonth: z.array(IntentUpliftSchema),
  totalUpliftSum: z.number(),
  totalBaselineSum: z.number(),
  upliftPercentage: z.number(),
  seasonalVolumeDebug: z.array(SeasonalVolumeDebugSchema).optional(),
});
export type ProjectionResults = z.infer<typeof ProjectionResultsSchema>;

// === Google Analytics Organic Report ===

export const GAReportRowSchema = z.object({
  date: z.string(),
  sessions: z.number(),
  transactions: z.number(),
  revenue: z.number(),
});
export type GAReportRow = z.infer<typeof GAReportRowSchema>;

export const GAHeadlineMetricsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  totalSessions: z.number(),
  totalTransactions: z.number(),
  totalRevenue: z.number(),
  averageOrderValue: z.number(),
  conversionRate: z.number(),
});
export type GAHeadlineMetrics = z.infer<typeof GAHeadlineMetricsSchema>;

export const GAReportResponseSchema = z.object({
  propertyId: z.string(),
  propertyName: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  rows: z.array(GAReportRowSchema),
  headline90Day: GAHeadlineMetricsSchema,
  generatedAt: z.string(),
  fromCache: z.boolean(),
});
export type GAReportResponse = z.infer<typeof GAReportResponseSchema>;

// === Google Search Console Report ===

export const GSCReportRowSchema = z.object({
  date: z.string(),
  totalClicks: z.number(),
  brandClicks: z.number(),
  nonBrandClicks: z.number(),
  anonymousClicks: z.number(),
});
export type GSCReportRow = z.infer<typeof GSCReportRowSchema>;

export const GSCHeadlineMetricsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  totalClicks: z.number(),
  totalBrandClicks: z.number(),
  totalNonBrandClicks: z.number(),
  ninetyDayBrandShare: z.number(),
});
export type GSCHeadlineMetrics = z.infer<typeof GSCHeadlineMetricsSchema>;

export const GSCQueryRowSchema = z.object({
  query: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
export type GSCQueryRow = z.infer<typeof GSCQueryRowSchema>;

export const GSCPositionCtrSchema = z.object({
  position: z.number(),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
});
export type GSCPositionCtr = z.infer<typeof GSCPositionCtrSchema>;

export const GSCReportResponseSchema = z.object({
  siteUrl: z.string(),
  brandTerms: z.array(z.string()),
  startDate: z.string(),
  endDate: z.string(),
  rows: z.array(GSCReportRowSchema),
  headline: GSCHeadlineMetricsSchema,
  generatedAt: z.string(),
  fromCache: z.boolean(),
  nonBrandQueries: z.array(GSCQueryRowSchema),
  nonBrandCtrByPosition: z.array(GSCPositionCtrSchema),
});
export type GSCReportResponse = z.infer<typeof GSCReportResponseSchema>;
