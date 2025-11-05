import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Preview as PreviewIcon } from "@nine-thirty-five/material-symbols-react/outlined";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { GAReportResponse, GSCReportResponse } from "@shared/schema";
import type {
  CombinedSessionsDatum,
  ProphetForecastResponse,
  ProphetStoredResults,
  ScalingSummarySnapshot,
} from "@shared/prophetTypes";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation } from "wouter";

type TrendOption = "flat" | "linear";

interface GoogleStatus {
  ga: {
    reportSummary: {
      propertyId: string;
      propertyName: string;
      headline90Day: { totalSessions: number };
    } | null;
  };
  gsc: {
    reportSummary: {
      siteUrl: string;
      brandTerms: string[];
      headline: { totalBrandClicks: number; totalNonBrandClicks: number };
    } | null;
  };
}

interface ForecastQueryKey {
  monthsAhead: number;
  brandTrend: TrendOption;
  nonBrandTrend: TrendOption;
  brandMultiplier: number;
  nonBrandMultiplier: number;
  brandTermsKey: string;
}

interface ProphetControlsState {
  monthsAhead: number;
  brandTrend: TrendOption;
  nonBrandTrend: TrendOption;
  brandMultiplier: number;
  nonBrandMultiplier: number;
}

interface ProphetPersistedState {
  controls: ProphetControlsState;
  results?: ProphetStoredResults | null;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  return debounced;
}

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyToDateString(key: string): string {
  return `${key}-01`;
}

function monthKeyToIndex(key: string): number {
  const [yearStr, monthStr] = key.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return 0;
  }
  return year * 12 + month;
}

const PROPHET_STORAGE_KEY = "prophet/state";

function readProphetStorage(): ProphetPersistedState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(PROPHET_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ProphetPersistedState;
  } catch {
    return null;
  }
}

function writeProphetStorage(
  updater: (previous: ProphetPersistedState | null) => ProphetPersistedState | null,
): void {
  if (typeof window === "undefined") {
    return;
  }
  const previous = readProphetStorage();
  const next = updater(previous);
  if (!next) {
    window.sessionStorage.removeItem(PROPHET_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(PROPHET_STORAGE_KEY, JSON.stringify(next));
}

export default function Prophet() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [rehydratedState] = useState<ProphetPersistedState | null>(() => readProphetStorage());
  const cachedControls =
    queryClient.getQueryData<ProphetControlsState>(["prophet/controls"]) ?? rehydratedState?.controls;

  const [monthsAhead, setMonthsAhead] = useState(cachedControls?.monthsAhead ?? 13);
  const [brandTrend, setBrandTrend] = useState<TrendOption>(cachedControls?.brandTrend ?? "flat");
  const [nonBrandTrend, setNonBrandTrend] = useState<TrendOption>(cachedControls?.nonBrandTrend ?? "flat");
  const [brandMultiplier, setBrandMultiplier] = useState(cachedControls?.brandMultiplier ?? 0);
  const [nonBrandMultiplier, setNonBrandMultiplier] = useState(cachedControls?.nonBrandMultiplier ?? 0);

  const { data: status, isLoading } = useQuery<GoogleStatus>({
    queryKey: ["/api/google/status"],
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const controlsSnapshot = useMemo<ProphetControlsState>(
    () => ({
      monthsAhead,
      brandTrend,
      nonBrandTrend,
      brandMultiplier,
      nonBrandMultiplier,
    }),
    [monthsAhead, brandTrend, nonBrandTrend, brandMultiplier, nonBrandMultiplier],
  );

  const controlsMatchStored = useMemo(() => {
    if (!rehydratedState?.controls) {
      return false;
    }
    const stored = rehydratedState.controls;
    return (
      stored.monthsAhead === controlsSnapshot.monthsAhead &&
      stored.brandTrend === controlsSnapshot.brandTrend &&
      stored.nonBrandTrend === controlsSnapshot.nonBrandTrend &&
      stored.brandMultiplier === controlsSnapshot.brandMultiplier &&
      stored.nonBrandMultiplier === controlsSnapshot.nonBrandMultiplier
    );
  }, [rehydratedState, controlsSnapshot]);

  useEffect(() => {
    queryClient.setQueryData<ProphetControlsState>(["prophet/controls"], controlsSnapshot);
    writeProphetStorage((previous) => ({
      controls: controlsSnapshot,
      results: previous?.results ?? null,
    }));
  }, [queryClient, controlsSnapshot]);

  useEffect(() => {
    if (!rehydratedState) {
      return;
    }
    if (rehydratedState.controls) {
      queryClient.setQueryData<ProphetControlsState>(["prophet/controls"], rehydratedState.controls);
    }
    if (rehydratedState.results) {
      queryClient.setQueryData<ProphetStoredResults>(["prophet/results"], rehydratedState.results);
    }
  }, [queryClient, rehydratedState]);

  const debouncedMonthsAhead = useDebouncedValue(monthsAhead, 400);
  const debouncedBrandMultiplier = useDebouncedValue(brandMultiplier, 400);
  const debouncedNonBrandMultiplier = useDebouncedValue(nonBrandMultiplier, 400);

  const numberFormatter = useMemo(() => new Intl.NumberFormat("en-GB"), []);
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "percent",
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }),
    [],
  );

  const hasGAData = Boolean(status?.ga?.reportSummary);
  const hasGSCData = Boolean(status?.gsc?.reportSummary);
  const readyForProjections = hasGAData && hasGSCData;

  const subtitle = readyForProjections
    ? "Tune the forecast horizon and growth assumptions for branded and non-branded organic demand."
    : "Projections will be available after completing the Google Analytics and Search Console phases of the process.";

  const missingPrerequisites = useMemo(() => {
    const missing: string[] = [];
    if (!hasGAData) {
      missing.push("Organic session data from Google Analytics");
    }
    if (!hasGSCData) {
      missing.push("Brand vs. non-brand data from Search Console");
    }
    return missing;
  }, [hasGAData, hasGSCData]);

  const brandTerms = useMemo(() => status?.gsc?.reportSummary?.brandTerms ?? [], [status?.gsc?.reportSummary]);

  const {
    data: gscReport,
    isLoading: isLoadingGSCReport,
    isError: hasGSCReportError,
  } = useQuery<GSCReportResponse>({
    queryKey: ["/api/google/gsc/report", brandTerms.join("|") || "none"],
    enabled: readyForProjections,
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/google/gsc/report", { brandTerms });
      return (await response.json()) as GSCReportResponse;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const {
    data: gaReport,
    isLoading: isLoadingGAReport,
    isError: hasGAReportError,
  } = useQuery<GAReportResponse>({
    queryKey: ["/api/google/ga/report"],
    enabled: readyForProjections,
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/google/ga/report", {});
      return (await response.json()) as GAReportResponse;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const ninetyDayClicks = useMemo(() => {
    if (!gscReport?.headline) {
      return { brand: 0, nonBrand: 0, total: 0 };
    }
    const start = new Date(`${gscReport.headline.startDate}T00:00:00`);
    const end = new Date(`${gscReport.headline.endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { brand: 0, nonBrand: 0, total: 0 };
    }

    let brand = 0;
    let nonBrand = 0;

    for (const row of gscReport.rows ?? []) {
      const rowDate = new Date(`${row.date}T00:00:00`);
      if (Number.isNaN(rowDate.getTime())) {
        continue;
      }
      if (rowDate < start || rowDate > end) {
        continue;
      }
      brand += row.brandClicks;
      nonBrand += row.nonBrandClicks;
    }

    return {
      brand,
      nonBrand,
      total: brand + nonBrand,
    };
  }, [gscReport]);

  const ninetyDaySessions = status?.ga?.reportSummary?.headline90Day.totalSessions ?? 0;

  const scalingSummary = useMemo(() => {
    const quantifiableClicks = Number.isFinite(ninetyDayClicks.total) ? Math.max(0, ninetyDayClicks.total) : 0;
    const gaSessions = Number.isFinite(ninetyDaySessions) ? Math.max(0, ninetyDaySessions) : 0;

    if (quantifiableClicks <= 0 || gaSessions <= 0) {
      return {
        quantifiableClicks,
        ninetyDaySessions: gaSessions,
        brandClicks: Math.max(0, ninetyDayClicks.brand),
        nonBrandClicks: Math.max(0, ninetyDayClicks.nonBrand),
        gap: gaSessions - quantifiableClicks,
        shortfallPercent: 0,
        scaleFactor: 1,
        isReady: false,
      };
    }

    const gap = gaSessions - quantifiableClicks;
    const shortfallPercent = gaSessions > 0 ? gap / gaSessions : 0;
    const scaleFactor = gaSessions / quantifiableClicks;

    return {
      quantifiableClicks,
      ninetyDaySessions: gaSessions,
      brandClicks: Math.max(0, ninetyDayClicks.brand),
      nonBrandClicks: Math.max(0, ninetyDayClicks.nonBrand),
      gap,
      shortfallPercent,
      scaleFactor,
      isReady: true,
    };
  }, [ninetyDayClicks, ninetyDaySessions]);

  const brandSeries = useMemo(
    () =>
      gscReport?.rows.map((row) => ({
        date: row.date,
        clicks: row.brandClicks,
      })) ?? [],
    [gscReport?.rows],
  );

  const nonBrandSeries = useMemo(
    () =>
      gscReport?.rows.map((row) => ({
        date: row.date,
        clicks: row.nonBrandClicks,
      })) ?? [],
    [gscReport?.rows],
  );

  const forecastQuery = useQuery<ProphetForecastResponse>({
    queryKey: [
      "/api/prophet/forecast",
      {
        monthsAhead: debouncedMonthsAhead,
        brandTrend,
        nonBrandTrend,
        brandMultiplier: debouncedBrandMultiplier,
        nonBrandMultiplier: debouncedNonBrandMultiplier,
        brandTermsKey: brandTerms.join("|"),
      } satisfies ForecastQueryKey,
    ],
    enabled:
      readyForProjections &&
      !isLoadingGSCReport &&
      !hasGSCReportError &&
      (gscReport?.rows?.length ?? 0) > 0,
    queryFn: async ({ queryKey }) => {
      const [, params] = queryKey as [string, ForecastQueryKey];
      const response = await apiRequest("POST", "/api/prophet/forecast", {
        monthsAhead: params.monthsAhead,
        brandTrend: params.brandTrend,
        nonBrandTrend: params.nonBrandTrend,
        brandMultiplier: params.brandMultiplier,
        nonBrandMultiplier: params.nonBrandMultiplier,
        brandTerms,
      });
      return (await response.json()) as ProphetForecastResponse;
    },
    initialData: () =>
      controlsMatchStored ? rehydratedState?.results?.forecast ?? undefined : undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const brandForecast = forecastQuery.data?.brand.forecast ?? [];
  const nonBrandForecast = forecastQuery.data?.nonBrand.forecast ?? [];

  const effectiveScaleFactor = useMemo(() => {
    if (!Number.isFinite(scalingSummary.scaleFactor) || scalingSummary.scaleFactor <= 0) {
      return 1;
    }
    return scalingSummary.scaleFactor;
  }, [scalingSummary.scaleFactor]);

  const combinedSessionsData = useMemo<CombinedSessionsDatum[]>(() => {
    if (!gaReport?.rows || gaReport.rows.length === 0) {
      return [];
    }
    if (brandForecast.length === 0 || nonBrandForecast.length === 0) {
      return [];
    }

    const lastActualRow = gaReport.rows[gaReport.rows.length - 1];
    const lastActualDate = new Date(`${lastActualRow.date}T00:00:00`);
    if (Number.isNaN(lastActualDate.getTime())) {
      return [];
    }

    const startWindow = startOfMonth(new Date());
    startWindow.setMonth(startWindow.getMonth() - 12);

    const forecastEndStr = forecastQuery.data?.brand.forecast_end;
    const forecastEndDate = forecastEndStr ? new Date(`${forecastEndStr}T00:00:00`) : lastActualDate;
    const endWindow = startOfMonth(forecastEndDate);

    if (endWindow < startWindow) {
      return [];
    }

    const months: string[] = [];
    const cursor = new Date(startWindow);
    while (cursor <= endWindow) {
      months.push(monthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const actualMap = new Map<string, number>();
    for (const row of gaReport.rows) {
      const rowDate = new Date(`${row.date}T00:00:00`);
      if (Number.isNaN(rowDate.getTime()) || rowDate < startWindow) {
        continue;
      }
      const key = monthKey(rowDate);
      actualMap.set(key, (actualMap.get(key) ?? 0) + row.sessions);
    }

    const forecastMap = new Map<string, { brand: number; nonBrand: number }>();
    for (const row of brandForecast) {
      const rowDate = new Date(`${row.date}T00:00:00`);
      if (Number.isNaN(rowDate.getTime()) || rowDate <= lastActualDate || rowDate < startWindow) {
        continue;
      }
      const key = monthKey(rowDate);
      const entry = forecastMap.get(key) ?? { brand: 0, nonBrand: 0 };
      entry.brand += Math.max(0, row.yhat * effectiveScaleFactor);
      forecastMap.set(key, entry);
    }

    for (const row of nonBrandForecast) {
      const rowDate = new Date(`${row.date}T00:00:00`);
      if (Number.isNaN(rowDate.getTime()) || rowDate <= lastActualDate || rowDate < startWindow) {
        continue;
      }
      const key = monthKey(rowDate);
      const entry = forecastMap.get(key) ?? { brand: 0, nonBrand: 0 };
      entry.nonBrand += Math.max(0, row.yhat * effectiveScaleFactor);
      forecastMap.set(key, entry);
    }

    const lastActualMonthKey = monthKey(lastActualDate);
    const lastActualMonthIndex = monthKeyToIndex(lastActualMonthKey);

    return months.map<CombinedSessionsDatum>((key) => {
      const monthIndex = monthKeyToIndex(key);
      const date = monthKeyToDateString(key);
      if (monthIndex <= lastActualMonthIndex) {
        return {
          date,
          monthKey: key,
          actualSessions: Math.max(0, actualMap.get(key) ?? 0),
          scaledBrand: 0,
          scaledNonBrand: 0,
          isForecast: false,
        };
      }

      const entry = forecastMap.get(key) ?? { brand: 0, nonBrand: 0 };
      return {
        date,
        monthKey: key,
        actualSessions: 0,
        scaledBrand: entry.brand,
        scaledNonBrand: entry.nonBrand,
        isForecast: true,
      };
    });
  }, [gaReport, brandForecast, nonBrandForecast, effectiveScaleFactor, forecastQuery.data?.brand.forecast_end]);

  const combinedSessionsAvailable = useMemo(
    () =>
      combinedSessionsData.some(
        (row) => row.actualSessions > 0 || row.scaledBrand > 0 || row.scaledNonBrand > 0,
      ),
    [combinedSessionsData],
  );

  const persistedResults = rehydratedState?.results ?? null;
  const effectiveScalingSummary = scalingSummary.isReady
    ? scalingSummary
    : persistedResults?.scalingSummary ?? scalingSummary;
  const effectiveCombinedSessions = combinedSessionsAvailable
    ? combinedSessionsData
    : persistedResults?.combinedSessions ?? [];
  const effectiveCombinedSessionsAvailable = effectiveCombinedSessions.some(
    (row) => row.actualSessions > 0 || row.scaledBrand > 0 || row.scaledNonBrand > 0,
  );

  useEffect(() => {
    if (!forecastQuery.data || !scalingSummary.isReady || !combinedSessionsAvailable) {
      return;
    }
    const resultsPayload: ProphetStoredResults = {
      forecast: forecastQuery.data,
      scalingSummary,
      combinedSessions: combinedSessionsData,
    };
    queryClient.setQueryData<ProphetStoredResults>(["prophet/results"], resultsPayload);
    writeProphetStorage((previous) => ({
      controls: previous?.controls ?? controlsSnapshot,
      results: resultsPayload,
    }));
  }, [
    queryClient,
    forecastQuery.data,
    scalingSummary,
    combinedSessionsAvailable,
    combinedSessionsData,
    controlsSnapshot,
  ]);

  const scalingFactorDisplay =
    effectiveScalingSummary.isReady && Number.isFinite(effectiveScalingSummary.scaleFactor)
      ? effectiveScalingSummary.scaleFactor.toFixed(2)
      : "—";
  const shortfallDisplay =
    effectiveScalingSummary.isReady && Number.isFinite(effectiveScalingSummary.shortfallPercent)
      ? percentFormatter.format(effectiveScalingSummary.shortfallPercent)
      : "—";
  const gapDescriptor = effectiveScalingSummary.isReady
    ? effectiveScalingSummary.shortfallPercent >= 0
      ? `${shortfallDisplay} shortfall`
      : `${percentFormatter.format(Math.abs(effectiveScalingSummary.shortfallPercent))} surplus`
    : "Awaiting data";

  const brandChartData = useMemo(() => {
    const map = new Map<string, { date: string; actual?: number; forecast?: number; forecastLowerBase?: number; forecastBand?: number }>();

    for (const row of brandSeries) {
      map.set(row.date, { date: row.date, actual: row.clicks });
    }

    for (const row of brandForecast) {
      const existing = map.get(row.date) ?? { date: row.date };
      existing.forecast = row.yhat;
      existing.forecastLowerBase = row.yhat_lower;
      existing.forecastBand = Math.max(0, row.yhat_upper - row.yhat_lower);
      map.set(row.date, existing);
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [brandSeries, brandForecast]);

  const nonBrandChartData = useMemo(() => {
    const map = new Map<string, { date: string; actual?: number; forecast?: number; forecastLowerBase?: number; forecastBand?: number }>();

    for (const row of nonBrandSeries) {
      map.set(row.date, { date: row.date, actual: row.clicks });
    }

    for (const row of nonBrandForecast) {
      const existing = map.get(row.date) ?? { date: row.date };
      existing.forecast = row.yhat;
      existing.forecastLowerBase = row.yhat_lower;
      existing.forecastBand = Math.max(0, row.yhat_upper - row.yhat_lower);
      map.set(row.date, existing);
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [nonBrandSeries, nonBrandForecast]);

  const canProceed =
    readyForProjections &&
    forecastQuery.isSuccess &&
    brandForecast.length > 0 &&
    nonBrandForecast.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
          <PreviewIcon className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prophet Projections</h1>
          <p className="text-muted-foreground mt-1">{subtitle}</p>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Checking prerequisite data sources...
          </CardContent>
        </Card>
      ) : !readyForProjections ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Complete the earlier workflow steps to unlock Prophet-based forecasting.
            </p>
            {missingPrerequisites.length > 0 && (
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Still required:</span>{" "}
                {missingPrerequisites.join(" and ")}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Projection Horizon</CardTitle>
              <CardDescription>Select the number of months to project forward.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Months ahead</span>
                <span className="font-semibold text-foreground">{monthsAhead} months</span>
              </div>
              <Slider
                value={[monthsAhead]}
                min={1}
                max={36}
                step={1}
                onValueChange={(value) => setMonthsAhead(value[0] ?? monthsAhead)}
                aria-label="Projection horizon in months"
              />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Brand Traffic</CardTitle>
                <CardDescription>Adjust trend assumptions for branded organic demand.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Trend assumption</Label>
                    <RadioGroup
                      value={brandTrend}
                      onValueChange={(value) => setBrandTrend(value as TrendOption)}
                      className="flex flex-wrap items-center gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="flat" id="brand-trend-flat" />
                        <Label htmlFor="brand-trend-flat" className="font-normal cursor-pointer">
                          Flat
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="linear" id="brand-trend-linear" />
                        <Label htmlFor="brand-trend-linear" className="font-normal cursor-pointer">
                          Linear
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <Label htmlFor="brand-multiplier-slider" className="text-muted-foreground">
                        Growth accelerator
                      </Label>
                      <span className="font-semibold text-foreground">{(1 + brandMultiplier).toFixed(2)}x</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Slider
                        id="brand-multiplier-slider"
                        value={[brandMultiplier]}
                        min={0}
                        max={5}
                        step={0.25}
                        onValueChange={(value) => setBrandMultiplier(value[0] ?? brandMultiplier)}
                        aria-label="Brand growth multiplier"
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>

                <div className="h-64">
                  {isLoadingGSCReport || forecastQuery.isPending ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Generating brand forecast...
                    </div>
                  ) : hasGSCReportError || forecastQuery.isError || brandChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Unable to generate brand forecast.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={brandChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" minTickGap={32} tickFormatter={formatDateLabel} />
                        <YAxis tickFormatter={(value) => numberFormatter.format(value)} />
                        <Tooltip
                          labelFormatter={(value) => formatDateLabel(String(value))}
                          formatter={(value, name) => {
                            if (name === "Actual" || name === "Forecast") {
                              const numeric = typeof value === "number" ? value : Number(value);
                              if (!Number.isFinite(numeric)) {
                                return null;
                              }
                              const label = name === "Actual" ? "Actual clicks" : "Forecast";
                              return [numberFormatter.format(numeric), label];
                            }
                            return null;
                          }}
                          filterNull
                        />
                        <Area
                          type="monotone"
                          dataKey="forecastLowerBase"
                          stackId="confidence"
                          stroke="none"
                          fill="transparent"
                          isAnimationActive={false}
                          activeDot={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="forecastBand"
                          stackId="confidence"
                          stroke="none"
                          fill="rgba(109, 40, 217, 0.16)"
                          isAnimationActive={false}
                          activeDot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          stroke="#6D28D9"
                          strokeWidth={2}
                          dot={false}
                          name="Actual"
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast"
                          stroke="#A855F7"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                          name="Forecast"
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Non-brand Traffic</CardTitle>
                <CardDescription>Control growth factors for non-branded organic demand.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Trend assumption</Label>
                    <RadioGroup
                      value={nonBrandTrend}
                      onValueChange={(value) => setNonBrandTrend(value as TrendOption)}
                      className="flex flex-wrap items-center gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="flat" id="nonbrand-trend-flat" />
                        <Label htmlFor="nonbrand-trend-flat" className="font-normal cursor-pointer">
                          Flat
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="linear" id="nonbrand-trend-linear" />
                        <Label htmlFor="nonbrand-trend-linear" className="font-normal cursor-pointer">
                          Linear
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <Label htmlFor="nonbrand-multiplier-slider" className="text-muted-foreground">
                        Growth accelerator
                      </Label>
                      <span className="font-semibold text-foreground">{(1 + nonBrandMultiplier).toFixed(2)}x</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Slider
                        id="nonbrand-multiplier-slider"
                        value={[nonBrandMultiplier]}
                        min={0}
                        max={5}
                        step={0.25}
                        onValueChange={(value) => setNonBrandMultiplier(value[0] ?? nonBrandMultiplier)}
                        aria-label="Non-brand growth multiplier"
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>

                <div className="h-64">
                  {isLoadingGSCReport || forecastQuery.isPending ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Generating non-brand forecast...
                    </div>
                  ) : hasGSCReportError || forecastQuery.isError || nonBrandChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Unable to generate non-brand forecast.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={nonBrandChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" minTickGap={32} tickFormatter={formatDateLabel} />
                        <YAxis tickFormatter={(value) => numberFormatter.format(value)} />
                        <Tooltip
                          labelFormatter={(value) => formatDateLabel(String(value))}
                          formatter={(value, name) => {
                            if (name === "Actual" || name === "Forecast") {
                              const numeric = typeof value === "number" ? value : Number(value);
                              if (!Number.isFinite(numeric)) {
                                return null;
                              }
                              const label = name === "Actual" ? "Actual clicks" : "Forecast";
                              return [numberFormatter.format(numeric), label];
                            }
                            return null;
                          }}
                          filterNull
                        />
                        <Area
                          type="monotone"
                          dataKey="forecastLowerBase"
                          stackId="confidence"
                          stroke="none"
                          fill="transparent"
                          isAnimationActive={false}
                          activeDot={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="forecastBand"
                          stackId="confidence"
                          stroke="none"
                          fill="rgba(14, 165, 233, 0.16)"
                          isAnimationActive={false}
                          activeDot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          stroke="#0EA5E9"
                          strokeWidth={2}
                          dot={false}
                          name="Actual"
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast"
                          stroke="#38BDF8"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                          name="Forecast"
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Organic Sessions Alignment</CardTitle>
                <CardDescription>Bridge GA sessions with scaled brand and non-brand forecasts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 rounded-lg border bg-muted/10 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      90 day organic sessions
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {numberFormatter.format(Math.round(effectiveScalingSummary.ninetyDaySessions))}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Quantifiable GSC clicks
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {numberFormatter.format(Math.round(effectiveScalingSummary.quantifiableClicks))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Brand {numberFormatter.format(Math.round(effectiveScalingSummary.brandClicks))} · Non-brand{" "}
                      {numberFormatter.format(Math.round(effectiveScalingSummary.nonBrandClicks))}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gap vs GA sessions</p>
                    <p className="text-lg font-semibold text-foreground">
                      {numberFormatter.format(Math.round(effectiveScalingSummary.gap))}
                    </p>
                    <p className="text-xs text-muted-foreground">{gapDescriptor}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scaling factor</p>
                    <p className="text-lg font-semibold text-foreground">{scalingFactorDisplay}x</p>
                    <p className="text-xs text-muted-foreground">
                      {effectiveScalingSummary.isReady ? "Applied to Prophet forecasts" : "Waiting for complete data"}
                    </p>
                  </div>
                </div>

                <div className="h-72">
                  {isLoadingGSCReport || isLoadingGAReport || forecastQuery.isPending ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Building scaled sessions view...
                    </div>
                  ) : hasGSCReportError || hasGAReportError || forecastQuery.isError ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Unable to combine Google Analytics and Search Console data.
                    </div>
                  ) : !effectiveCombinedSessionsAvailable ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Scaled projection data will appear once forecasts and session history are ready.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={effectiveCombinedSessions}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" minTickGap={32} tickFormatter={formatDateLabel} />
                        <YAxis tickFormatter={(value) => numberFormatter.format(value)} />
                        <Tooltip
                          labelFormatter={(value) => formatDateLabel(String(value))}
                          formatter={(value) => {
                            const numeric = typeof value === "number" ? value : Number(value);
                            if (!Number.isFinite(numeric)) {
                              return null;
                            }
                            return [numberFormatter.format(Math.round(numeric)), undefined];
                          }}
                          filterNull
                        />
                        <Bar
                          dataKey="actualSessions"
                          name="Actual sessions"
                          stackId="sessions"
                          fill="#6366F1"
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="scaledBrand"
                          name="Projected brand (scaled)"
                          stackId="sessions"
                          fill="#A855F7"
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="scaledNonBrand"
                          name="Projected non-brand (scaled)"
                          stackId="sessions"
                          fill="#38BDF8"
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {canProceed && (
            <div className="flex justify-end pt-4">
              <Button
                size="lg"
                onClick={() => navigate("/uplift")}
                className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 animate-cta-pulse gap-2 border-0"
              >
                <span className="material-symbols-outlined text-xl" aria-hidden="true">
                  arrow_circle_down
                </span>
                Proceed to Next Phase
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
