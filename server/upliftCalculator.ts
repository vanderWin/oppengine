// Uplift Calculator - Rank Projection Engine
// Translated from Python reference (uplift_calc_1761925423051.py)

import type {
  UpliftParameters,
  KeywordRow,
  ProjectionRow,
  MonthlyAggregate,
  ProjectionResults,
} from "@shared/schema";
import { getCachedSeasonalVolume } from "./googleAdsCache";

interface Phase {
  startRank: number;
  endRank: number;
  duration: number;
}

// Helper: Calculate scaled phase times based on volume and difficulty
function scaledPhaseTimes(
  volume: number,
  volMax: number,
  difficultyLabel: string,
  params: UpliftParameters
): Phase[] {
  const { phaseDurations, difficultyMultipliers, volumeMultiplier } = params;
  const { T1, T2, T3, T4 } = phaseDurations;
  
  // Base phases: (start_rank, end_rank, base_duration)
  const basePhases: Phase[] = [
    { startRank: 100, endRank: 50, duration: T1 },
    { startRank: 50, endRank: 20, duration: T2 },
    { startRank: 20, endRank: 10, duration: T3 },
    { startRank: 10, endRank: 1, duration: T4 },
  ];

  // Get difficulty multiplier - normalize to match schema keys
  const diffNormalized = difficultyLabel.trim();
  let md = difficultyMultipliers["N/A"];
  
  // Try exact match first, then case-insensitive match
  if (diffNormalized in difficultyMultipliers) {
    md = difficultyMultipliers[diffNormalized as keyof typeof difficultyMultipliers];
  } else {
    // Case-insensitive fallback for "Easy", "Medium", "Hard", "Top10", "N/A"
    const diffUpper = diffNormalized.toUpperCase();
    if (diffUpper === "EASY" && "Easy" in difficultyMultipliers) md = difficultyMultipliers.Easy;
    else if (diffUpper === "MEDIUM" && "Medium" in difficultyMultipliers) md = difficultyMultipliers.Medium;
    else if (diffUpper === "HARD" && "Hard" in difficultyMultipliers) md = difficultyMultipliers.Hard;
    else if (diffUpper === "TOP10" && "Top10" in difficultyMultipliers) md = difficultyMultipliers.Top10;
    else if (diffUpper === "N/A" || diffUpper === "NA") md = difficultyMultipliers["N/A"];
  }

  // Calculate volume multiplier
  const { vMin, vSpan, mMin, mMax } = volumeMultiplier;
  const den = volMax > 0 ? Math.log10(1 + volMax) : 1.0;
  const norm = den > 0 ? Math.log10(1 + Math.max(volume, 0)) / den : 0.0;
  const mv = Math.max(mMin, Math.min(mMax, vMin + vSpan * norm));

  // Apply multipliers to all phases
  return basePhases.map(phase => ({
    ...phase,
    duration: phase.duration * md * mv,
  }));
}

// Build active phases starting from a given rank
function buildPhases(
  startRank: number,
  volume: number,
  volMax: number,
  difficultyLabel: string,
  params: UpliftParameters
): Phase[] {
  const phases = scaledPhaseTimes(volume, volMax, difficultyLabel, params);
  
  // Find the active phase and trim it
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    if (phase.startRank >= startRank && startRank >= phase.endRank) {
      const fracRemaining = (startRank - phase.endRank) / (phase.startRank - phase.endRank + 1e-9);
      const tRem = Math.max(1e-9, phase.duration * fracRemaining);
      return [
        { startRank, endRank: phase.endRank, duration: tRem },
        ...phases.slice(i + 1),
      ];
    }
  }

  // If already < 10, do the tail of 10→1 only
  if (startRank < 10) {
    const phase = phases.find(p => p.startRank === 10 && p.endRank === 1)!;
    const fracRemaining = (startRank - phase.endRank) / (phase.startRank - phase.endRank + 1e-9);
    return [{ startRank, endRank: phase.endRank, duration: Math.max(1e-9, phase.duration * fracRemaining) }];
  }

  return phases;
}

// Calculate rank at a specific month using exponential decay S-curve
export function rankAtMonth(
  t: number,
  startRank: number,
  volume: number,
  volMax: number,
  difficultyLabel: string,
  params: UpliftParameters
): number {
  const { phaseDurations } = params;
  const k = phaseDurations.k;
  
  const phases = buildPhases(startRank, volume, volMax, difficultyLabel, params);
  let rem = t;
  let cur = startRank;

  for (const phase of phases) {
    if (rem <= 0) {
      return cur;
    }
    if (rem >= phase.duration) {
      cur = phase.endRank;
      rem -= phase.duration;
    } else {
      const frac = rem / Math.max(phase.duration, 1e-9);
      const r = phase.endRank + (phase.startRank - phase.endRank) * Math.exp(-k * frac);
      return Math.min(cur, r); // Monotonic improvement
    }
  }

  return cur;
}

// Get CTR for a given rank from the CTR curve
export function ctrTop20(rank: number, ctrValues: number[]): number {
  const r = Math.round(rank);
  if (r >= 1 && r <= ctrValues.length) {
    return ctrValues[r - 1];
  }
  return 0.0;
}

// Add months to a date
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// Project a single keyword's rank over the horizon
export function projectKeyword(
  row: KeywordRow,
  horizon: number,
  params: UpliftParameters,
  volMax: number
): number[] {
  const diffLabel = row.difficulty || "N/A";
  const rankCaps = params.rankCaps;
  
  // Get rank cap for this difficulty level
  let capValue: number | null = null;
  if (diffLabel in rankCaps) {
    capValue = rankCaps[diffLabel as keyof typeof rankCaps];
  }
  
  // If already at or better than cap, don't apply cap
  if (capValue !== null && row.startRank <= capValue) {
    capValue = null;
  }

  const ranks: number[] = [];
  for (let t = 0; t <= horizon; t++) {
    let r = rankAtMonth(t, row.startRank, row.volume, volMax, diffLabel, params);
    r = Math.max(1.0, r);
    if (capValue !== null) {
      r = Math.max(r, capValue); // Cap prevents going better than capValue
    }
    ranks.push(r);
  }

  return ranks;
}

// Main batch forecast function
export function batchForecast(
  keywords: KeywordRow[],
  params: UpliftParameters
): ProjectionResults {
  const { projectionHorizon, ctrValues, volumeMultiplier } = params;
  const horizon = projectionHorizon.monthsAhead;
  
  // Calculate vol_max
  let volMax: number;
  if (volumeMultiplier.volMaxMode === "auto") {
    volMax = Math.max(...keywords.map(k => k.volume), 1);
  } else {
    volMax = volumeMultiplier.volMaxManual;
  }

  // Generate month start dates
  const startDate = new Date(projectionHorizon.startDate);
  const monthStarts: Date[] = [];
  for (let i = 0; i <= horizon; i++) {
    monthStarts.push(addMonths(startDate, i));
  }

  const detailedProjections: ProjectionRow[] = [];
  const seasonalVolumeDebug: Array<{ keyword: string; monthlyVolumes: number[]; source: "cache" | "fallback" }> = [];

  // Process each keyword
  for (const keyword of keywords) {
    const projectedRanks = projectKeyword(keyword, horizon, params, volMax);
    const ctrVals = projectedRanks.map(rank => ctrTop20(rank, ctrValues));
    
    // Build volume array based on projection mode
    let volumes: number[];
    if (projectionHorizon.mode === "Seasonal") {
      // Try to get seasonal data from cache
      const seasonalData = getCachedSeasonalVolume(keyword.keyword);
      if (seasonalData && seasonalData.monthlyVolumes.length >= 12) {
        // Map projection months to seasonal data (cycling through 12-month pattern)
        volumes = [];
        const startMonth = new Date(projectionHorizon.startDate).getMonth();
        const fallbackVolume =
          seasonalData.averageMonthlySearches && seasonalData.averageMonthlySearches > 0
            ? seasonalData.averageMonthlySearches
            : keyword.volume;
        for (let i = 0; i <= horizon; i++) {
          const monthIndex = (startMonth + i) % 12;
          const monthVolume = seasonalData.monthlyVolumes[monthIndex];
          volumes.push(monthVolume && monthVolume > 0 ? monthVolume : fallbackVolume);
        }
        
        // Track debug data
        seasonalVolumeDebug.push({
          keyword: seasonalData.matchedVariant ?? seasonalData.keyword,
          monthlyVolumes: seasonalData.monthlyVolumes,
          source: "cache",
        });
      } else {
        // Fall back to average if no seasonal data available
        volumes = new Array(horizon + 1).fill(keyword.volume);
        
        // Track debug data for fallback
        seasonalVolumeDebug.push({
          keyword: keyword.keyword,
          monthlyVolumes: new Array(12).fill(keyword.volume),
          source: "fallback",
        });
      }
    } else {
      // Average mode: constant volume
      volumes = new Array(horizon + 1).fill(keyword.volume);
    }
    
    const visits = ctrVals.map((ctr, i) => ctr * volumes[i]);
    const baselineCtr = ctrTop20(keyword.startRank, ctrValues);
    const baselineVisits = volumes.map(v => baselineCtr * v);

    for (let m = 0; m <= horizon; m++) {
      const uplift = visits[m] - baselineVisits[m];
      detailedProjections.push({
        keyword: keyword.keyword,
        volume: keyword.volume,
        difficulty: keyword.difficulty || "N/A",
        startRank: keyword.startRank,
        category: keyword.category,
        mainCategory: keyword.category?.split('|')[0]?.trim() || "Uncategorized",
        intent: keyword.intent,
        monthAhead: m,
        monthStart: monthStarts[m].toISOString().split('T')[0],
        predRank: Math.round(projectedRanks[m] * 100) / 100,
        expCtr: Math.round(ctrVals[m] * 100000) / 100000,
        expVisits: Math.round(visits[m] * 100) / 100,
        baselineVisits: Math.round(baselineVisits[m] * 100) / 100,
        expUplift: Math.round(uplift * 100) / 100,
      });
    }
  }

  // Aggregate by month (excluding month 0 = baseline)
  const futureProjections = detailedProjections.filter(p => p.monthAhead > 0);
  
  const monthlyAggregates: MonthlyAggregate[] = [];
  const monthMap = new Map<string, { uplift: number; visits: number; baseline: number }>();

  for (const proj of futureProjections) {
    const existing = monthMap.get(proj.monthStart) || { uplift: 0, visits: 0, baseline: 0 };
    monthMap.set(proj.monthStart, {
      uplift: existing.uplift + proj.expUplift,
      visits: existing.visits + proj.expVisits,
      baseline: existing.baseline + proj.baselineVisits,
    });
  }

  Array.from(monthMap.entries()).forEach(([monthStart, data]) => {
    monthlyAggregates.push({
      monthStart,
      totalUplift: Math.round(data.uplift * 100) / 100,
      totalVisits: Math.round(data.visits * 100) / 100,
      totalBaseline: Math.round(data.baseline * 100) / 100,
    });
  });

  // Sort by date
  monthlyAggregates.sort((a, b) => a.monthStart.localeCompare(b.monthStart));

  const totalUpliftSum = monthlyAggregates.reduce((sum, m) => sum + m.totalUplift, 0);
  const totalBaselineSum = monthlyAggregates.reduce((sum, m) => sum + m.totalBaseline, 0);
  const upliftPercentage = totalBaselineSum > 0 ? (totalUpliftSum / totalBaselineSum) * 100 : 0;

  // Calculate category uplift by month (excluding month 0 baseline)
  const categoryUpliftByMonth: Array<{ monthStart: string; category: string; uplift: number }> = [];
  const categoryByMonth = new Map<string, Map<string, number>>();

  futureProjections.forEach(proj => {
    const key = proj.monthStart;
    const category = proj.mainCategory || "Uncategorized";
    
    if (!categoryByMonth.has(key)) {
      categoryByMonth.set(key, new Map());
    }
    const monthCategories = categoryByMonth.get(key)!;
    monthCategories.set(category, (monthCategories.get(category) || 0) + proj.expUplift);
  });

  categoryByMonth.forEach((categories, monthStart) => {
    categories.forEach((uplift, category) => {
      categoryUpliftByMonth.push({ monthStart, category, uplift });
    });
  });

  // Calculate intent uplift by month (excluding month 0 baseline)
  const intentUpliftByMonth: Array<{ monthStart: string; intent: string; uplift: number }> = [];
  const intentByMonth = new Map<string, Map<string, number>>();

  futureProjections.forEach(proj => {
    const key = proj.monthStart;
    const intent = proj.intent || "Unknown";
    
    if (!intentByMonth.has(key)) {
      intentByMonth.set(key, new Map());
    }
    const monthIntents = intentByMonth.get(key)!;
    monthIntents.set(intent, (monthIntents.get(intent) || 0) + proj.expUplift);
  });

  intentByMonth.forEach((intents, monthStart) => {
    intents.forEach((uplift, intent) => {
      intentUpliftByMonth.push({ monthStart, intent, uplift });
    });
  });

  return {
    detailedProjections,
    monthlyAggregates,
    categoryUpliftByMonth,
    intentUpliftByMonth,
    totalUpliftSum: Math.round(totalUpliftSum * 100) / 100,
    totalBaselineSum: Math.round(totalBaselineSum * 100) / 100,
    upliftPercentage: Math.round(upliftPercentage * 100) / 100,
    seasonalVolumeDebug: seasonalVolumeDebug.length > 0 ? seasonalVolumeDebug : undefined,
  };
}
