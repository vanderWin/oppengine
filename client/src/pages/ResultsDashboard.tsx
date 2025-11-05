import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GAReportResponse, ProjectionResults } from "@shared/schema";
import type { DashboardBootstrapPayload, ProphetStoredResults } from "@shared/prophetTypes";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hierarchy, pack } from "d3-hierarchy";
import { Download, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Counter as CounterZero,
  CounterEight,
  CounterFive,
  CounterFour,
  CounterNine,
  CounterOne,
  CounterSeven,
  CounterSix,
  CounterThree,
  CounterTwo,
  MoneyBag,
  OfflineBolt,
  ShoppingCartCheckout,
  TimerTen,
} from "@nine-thirty-five/material-symbols-react/outlined";

const PROPHET_STORAGE_KEY = "prophet/state";
const UPLIFT_STORAGE_KEY = "uplift/state";

const OPPORTUNITY_SCORE_ICON: Record<number, typeof CounterZero> = {
  0: CounterZero,
  1: CounterOne,
  2: CounterTwo,
  3: CounterThree,
  4: CounterFour,
  5: CounterFive,
  6: CounterSix,
  7: CounterSeven,
  8: CounterEight,
  9: CounterNine,
  10: TimerTen,
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "text-emerald-500",
  medium: "text-amber-500",
  hard: "text-rose-500",
};

const PROJECTION_METRIC_LABEL: Record<"sessions" | "transactions" | "revenue", string> = {
  sessions: "Sessions",
  transactions: "Transactions",
  revenue: "Revenue",
};

const CATEGORY_COLORS = [
  "#6366F1",
  "#F97316",
  "#EC4899",
  "#22C55E",
  "#0EA5E9",
  "#A855F7",
  "#F43F5E",
  "#14B8A6",
  "#F59E0B",
  "#10B981",
];

type CategoryHierarchyNode = {
  name: string;
  value?: number;
  children?: CategoryHierarchyNode[];
};

function monthKeyToIndex(key: string): number {
  const [yearStr, monthStr] = key.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return Number.NaN;
  }
  return year * 12 + (month - 1);
}

function formatMonthLabel(value: string): string {
  const iso = value.includes("T") ? value : `${value}T00:00:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

interface ProphetPersistedState {
  controls?: {
    monthsAhead: number;
    brandTrend: string;
    nonBrandTrend: string;
    brandMultiplier: number;
    nonBrandMultiplier: number;
  };
  results?: ProphetStoredResults | null;
}

interface UpliftPersistedState {
  results: ProjectionResults | null;
}

interface StatusResponse {
  ga: {
    connected: boolean;
    hasTokens: boolean;
    reportSummary:
      | {
          propertyId: string;
          propertyName: string;
          fetchedAt: string;
          headline90Day: {
            totalSessions: number;
            totalTransactions: number;
            totalRevenue: number;
            averageOrderValue: number;
            conversionRate: number;
          };
        }
      | null;
  };
  gsc: {
    connected: boolean;
    hasTokens?: boolean;
    reportSummary:
      | {
          siteUrl: string;
          brandTerms: string[];
          fetchedAt: string;
        }
      | null;
  };
}

interface SummaryCardProps {
  title: string;
  description?: string;
  sessionsDisplay: string;
  transactionsDisplay: string;
  revenueDisplay: string;
  highlight?: boolean;
}

function readProphetState(): ProphetPersistedState | null {
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

function readUpliftState(): UpliftPersistedState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(UPLIFT_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as UpliftPersistedState;
  } catch {
    return null;
  }
}

function SummaryCard({
  title,
  description,
  sessionsDisplay,
  transactionsDisplay,
  revenueDisplay,
  highlight,
}: SummaryCardProps) {
  const sessionsUnavailable = sessionsDisplay === "--";
  const transactionsUnavailable = transactionsDisplay === "--";
  const revenueUnavailable = revenueDisplay === "--";
  const sessionsTone = highlight && !sessionsUnavailable ? "text-emerald-500" : "";
  const transactionsTone = highlight && !transactionsUnavailable ? "text-emerald-500" : "";
  const revenueTone = highlight && !revenueUnavailable ? "text-emerald-500" : "";

  return (
    <Card className="h-full">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div>
          <div className={`text-3xl font-semibold ${sessionsUnavailable ? "text-muted-foreground" : sessionsTone}`}>
            {sessionsDisplay}
          </div>
          <p className="text-sm text-muted-foreground">Sessions</p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <ShoppingCartCheckout className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className={`font-semibold ${transactionsUnavailable ? "text-muted-foreground" : transactionsTone}`}>
              {transactionsDisplay}
            </span>
            <span className="text-muted-foreground">Transactions</span>
          </div>
          <div className="flex items-center gap-2">
            <MoneyBag className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className={`font-semibold ${revenueUnavailable ? "text-muted-foreground" : revenueTone}`}>
              {revenueDisplay}
            </span>
            <span className="text-muted-foreground">Revenue</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
export default function ResultsDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [hydratedProphet] = useState<ProphetPersistedState | null>(() => readProphetState());
  const [hydratedUplift] = useState<UpliftPersistedState | null>(() => readUpliftState());
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);

  const { data: status, isLoading: isStatusLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/google/status"],
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const prophetQuery = useQuery<ProphetStoredResults | null>({
    queryKey: ["prophet/results"],
    queryFn: () =>
      Promise.resolve(
        queryClient.getQueryData<ProphetStoredResults>(["prophet/results"]) ?? hydratedProphet?.results ?? null,
      ),
    initialData: () => queryClient.getQueryData<ProphetStoredResults>(["prophet/results"]) ?? hydratedProphet?.results ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const upliftQuery = useQuery<UpliftPersistedState | null>({
    queryKey: ["uplift/state"],
    queryFn: () =>
      Promise.resolve(
        queryClient.getQueryData<UpliftPersistedState>(["uplift/state"]) ?? hydratedUplift ?? null,
      ),
    initialData: () => queryClient.getQueryData<UpliftPersistedState>(["uplift/state"]) ?? hydratedUplift ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const prophetResults = prophetQuery.data;
  const upliftState = upliftQuery.data;
  const upliftResults = upliftState?.results ?? null;
  const [projectionMetric, setProjectionMetric] = useState<"sessions" | "transactions" | "revenue">("sessions");

  const { data: bootstrapData } = useQuery<DashboardBootstrapPayload>({
    queryKey: ["/api/dashboard/bootstrap"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/dashboard/bootstrap");
      return (await response.json()) as DashboardBootstrapPayload;
    },
    enabled: !(prophetResults?.combinedSessions?.length) || !upliftResults,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const { data: gaReport, isLoading: isLoadingGaReport, isError: hasGaReportError } = useQuery<GAReportResponse>({
    queryKey: ["/api/google/ga/report"],
    enabled: Boolean(status?.ga?.reportSummary),
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/google/ga/report", {});
      if (!response.ok) {
        throw new Error("Failed to fetch GA report");
      }
      return (await response.json()) as GAReportResponse;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!bootstrapData) {
      return;
    }

    if (bootstrapData.prophet && !(prophetResults?.combinedSessions?.length)) {
      const nextResults = bootstrapData.prophet;
      queryClient.setQueryData<ProphetStoredResults>(["prophet/results"], nextResults);

      if (typeof window !== "undefined") {
        const previous = readProphetState();
        const nextState = {
          ...(previous ?? {}),
          results: nextResults,
        };
        window.sessionStorage.setItem(PROPHET_STORAGE_KEY, JSON.stringify(nextState));
      }
    }

    if (bootstrapData.uplift && !upliftResults) {
      const statePayload: UpliftPersistedState = { results: bootstrapData.uplift };
      queryClient.setQueryData<UpliftPersistedState>(["uplift/state"], statePayload);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(UPLIFT_STORAGE_KEY, JSON.stringify(statePayload));
      }
    }
  }, [bootstrapData, prophetResults, upliftResults, queryClient]);

  const handleDownloadExcel = useCallback(async () => {
    try {
      setIsDownloadingExcel(true);
      const response = await apiRequest("GET", "/api/report/excel");
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      let filename = `oppengine-report-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
      const match = disposition?.match(/filename=\"?([^\";]+)\"?/i);
      if (match?.[1]) {
        filename = match[1];
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      console.error("Failed to export Excel workbook:", error);
      toast({
        title: "Excel export failed",
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while creating the workbook.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingExcel(false);
    }
  }, [toast]);

  const hasGAData = Boolean(status?.ga?.reportSummary);
  const hasGSCData = Boolean(status?.gsc?.reportSummary);
  const hasProphetResults = Boolean(prophetResults?.combinedSessions?.length);
  const hasUpliftResults = Boolean(upliftResults);

  const missingPrerequisites = useMemo(() => [] as string[], []);

  const lastTwelveMonthsTotals = useMemo(() => {
    if (!gaReport?.rows || gaReport.rows.length === 0) {
      return { sessions: null, transactions: null, revenue: null };
    }
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setMonth(cutoff.getMonth() - 12);

    return gaReport.rows.reduce(
      (acc, row) => {
        const rowDate = new Date(`${row.date}T00:00:00`);
        if (Number.isNaN(rowDate.getTime()) || rowDate < cutoff) {
          return acc;
        }
        acc.sessions += Number.isFinite(row.sessions) ? row.sessions : 0;
        acc.transactions += Number.isFinite(row.transactions) ? row.transactions : 0;
        acc.revenue += Number.isFinite(row.revenue) ? row.revenue : 0;
        return acc;
      },
      { sessions: 0, transactions: 0, revenue: 0 },
    );
  }, [gaReport?.rows]);

  const projectedBaselineSessions = useMemo(() => {
    if (!prophetResults?.combinedSessions) {
      return null;
    }
    return prophetResults.combinedSessions
      .filter((entry) => entry.isForecast)
      .reduce((total, entry) => {
        const brand = Number.isFinite(entry.scaledBrand) ? entry.scaledBrand : 0;
        const nonBrand = Number.isFinite(entry.scaledNonBrand) ? entry.scaledNonBrand : 0;
        return total + brand + nonBrand;
      }, 0);
  }, [prophetResults?.combinedSessions]);

  const projectionMonths = useMemo(() => {
    if (!prophetResults?.combinedSessions) {
      return 0;
    }
    return prophetResults.combinedSessions.reduce((count, entry) => count + (entry.isForecast ? 1 : 0), 0);
  }, [prophetResults?.combinedSessions]);

  const compactNumberFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }),
    [],
  );
  const compactCurrencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        notation: "compact",
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }),
    [],
  );
  const standardCurrencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }),
    [],
  );

  const integerFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        maximumFractionDigits: 0,
      }),
    [],
  );

  const rankFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }),
    [],
  );

  const formatNumber = useCallback(
    (value: number | null | undefined, prefix = "") => {
      if (value == null || !Number.isFinite(value)) {
        return "--";
      }
      return `${prefix}${compactNumberFormatter.format(value)}`;
    },
    [compactNumberFormatter],
  );

  const formatCurrency = useCallback(
    (value: number | null | undefined, prefix = "") => {
      if (value == null || !Number.isFinite(value)) {
        return "--";
      }
      return `${prefix}${compactCurrencyFormatter.format(value)}`;
    },
    [compactCurrencyFormatter],
  );
  const gaHeadline = gaReport?.headline90Day ?? status?.ga?.reportSummary?.headline90Day ?? null;
  const conversionRatePct = Number.isFinite(gaHeadline?.conversionRate) ? gaHeadline!.conversionRate : 0;
  const averageOrderValue = Number.isFinite(gaHeadline?.averageOrderValue) ? gaHeadline!.averageOrderValue : 0;
  const hasEcommerceMetrics = conversionRatePct > 0 && averageOrderValue > 0;
  const conversionRateDecimal = hasEcommerceMetrics ? conversionRatePct / 100 : 0;

  useEffect(() => {
    if (!hasEcommerceMetrics && projectionMetric !== "sessions") {
      setProjectionMetric("sessions");
    }
  }, [hasEcommerceMetrics, projectionMetric]);

  const baselineTransactions =
    hasEcommerceMetrics && projectedBaselineSessions != null
      ? projectedBaselineSessions * conversionRateDecimal
      : null;
  const baselineRevenue =
    hasEcommerceMetrics && baselineTransactions != null ? baselineTransactions * averageOrderValue : null;

  const upliftTransactions =
    hasEcommerceMetrics && upliftResults ? upliftResults.totalUpliftSum * conversionRateDecimal : null;
  const upliftRevenue =
    hasEcommerceMetrics && upliftTransactions != null ? upliftTransactions * averageOrderValue : null;

  const monthlyUpliftMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!upliftResults?.monthlyAggregates?.length) {
      return map;
    }
    for (const aggregate of upliftResults.monthlyAggregates) {
      const monthStart = typeof aggregate.monthStart === "string" ? aggregate.monthStart : "";
      if (!monthStart) {
        continue;
      }
      const monthKey = monthStart.slice(0, 7);
      const value = Number(aggregate.totalUplift);
      map.set(monthKey, Number.isFinite(value) ? Math.max(0, value) : 0);
    }
    return map;
  }, [upliftResults?.monthlyAggregates]);

  const maxUpliftMonthIndex = useMemo(() => {
    if (monthlyUpliftMap.size === 0) {
      return null;
    }
    let maxIndex: number | null = null;
    monthlyUpliftMap.forEach((_, key) => {
      const idx = monthKeyToIndex(key);
      if (!Number.isFinite(idx)) {
        return;
      }
      if (maxIndex == null || idx > maxIndex) {
        maxIndex = idx;
      }
    });
    return maxIndex;
  }, [monthlyUpliftMap]);

  const monthlyProjectionBase = useMemo(() => {
    if (!prophetResults?.combinedSessions?.length) {
      return [] as Array<{
        date: string;
        monthKey: string;
        isForecast: boolean;
        actualSessions: number;
        baselineBrandSessions: number;
        baselineNonBrandSessions: number;
        upliftSessions: number;
      }>;
    }

    return prophetResults.combinedSessions
      .map((entry) => {
        const monthKey =
          entry.monthKey && entry.monthKey.length > 0
            ? entry.monthKey
          : entry.date
          ? entry.date.slice(0, 7)
          : "";
        if (!monthKey) {
          return null;
        }
        const monthIndex = monthKeyToIndex(monthKey);
        if (entry.isForecast && maxUpliftMonthIndex != null && Number.isFinite(monthIndex) && monthIndex > maxUpliftMonthIndex) {
          return null;
        }
        const upliftSessions = entry.isForecast ? monthlyUpliftMap.get(monthKey) ?? 0 : 0;
        return {
          date: entry.date,
          monthKey,
          isForecast: entry.isForecast,
          actualSessions: Number.isFinite(entry.actualSessions) ? Math.max(0, entry.actualSessions) : 0,
          baselineBrandSessions: Number.isFinite(entry.scaledBrand) ? Math.max(0, entry.scaledBrand) : 0,
          baselineNonBrandSessions: Number.isFinite(entry.scaledNonBrand) ? Math.max(0, entry.scaledNonBrand) : 0,
          upliftSessions: Math.max(0, upliftSessions),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [prophetResults?.combinedSessions, monthlyUpliftMap, maxUpliftMonthIndex]);

  const projectionMultiplier = useMemo(() => {
    if (projectionMetric === "sessions") {
      return 1;
    }
    if (projectionMetric === "transactions") {
      return conversionRateDecimal;
    }
    return conversionRateDecimal * averageOrderValue;
  }, [projectionMetric, conversionRateDecimal, averageOrderValue]);

  const projectionChartData = useMemo(
    () =>
      monthlyProjectionBase.map((entry) => ({
        date: entry.date,
        monthKey: entry.monthKey,
        isForecast: entry.isForecast,
        actual: entry.actualSessions * projectionMultiplier,
        baselineBrand: entry.baselineBrandSessions * projectionMultiplier,
        baselineNonBrand: entry.baselineNonBrandSessions * projectionMultiplier,
        uplift: entry.upliftSessions * projectionMultiplier,
      })),
    [monthlyProjectionBase, projectionMultiplier],
  );

  const projectionChartHasData = useMemo(
    () =>
      projectionChartData.some(
        (entry) =>
          (Number.isFinite(entry.actual) && Math.abs(entry.actual) > 0) ||
          (Number.isFinite(entry.baselineBrand) && Math.abs(entry.baselineBrand) > 0) ||
          (Number.isFinite(entry.baselineNonBrand) && Math.abs(entry.baselineNonBrand) > 0) ||
          (Number.isFinite(entry.uplift) && Math.abs(entry.uplift) > 0),
      ),
    [projectionChartData],
  );

  const formatProjectionValue = useCallback(
    (value: number, signed = false) => {
      if (!Number.isFinite(value)) {
        return "";
      }
      const prefix = signed && value > 0 ? "+" : "";
      if (projectionMetric === "revenue") {
        return `${prefix}${compactCurrencyFormatter.format(value)}`;
      }
      return `${prefix}${compactNumberFormatter.format(Math.round(value))}`;
    },
    [projectionMetric, compactCurrencyFormatter, compactNumberFormatter],
  );

  const projectionTickFormatter = useCallback(
    (value: number) => {
      return formatProjectionValue(value);
    },
    [formatProjectionValue],
  );

  const projectionMetricChoices = useMemo<Array<"sessions" | "transactions" | "revenue">>(
    () => (hasEcommerceMetrics ? ["sessions", "transactions", "revenue"] : ["sessions"]),
    [hasEcommerceMetrics],
  );

  const activeProjectionMetricLabel = PROJECTION_METRIC_LABEL[projectionMetric];
  const activeProjectionMetricLower = activeProjectionMetricLabel.toLowerCase();

  const projectionTooltipFormatter = useCallback(
    (value: number) => {
      return formatProjectionValue(value);
    },
    [formatProjectionValue],
  );

  const projectionSummary = useMemo(() => {
    if (projectionChartData.length === 0) {
      return null;
    }
    let baselineTotal = 0;
    let upliftTotal = 0;
    let monthCount = 0;
    for (const entry of projectionChartData) {
      if (!entry.isForecast) {
        continue;
      }
      baselineTotal += (Number.isFinite(entry.baselineBrand) ? entry.baselineBrand : 0) +
        (Number.isFinite(entry.baselineNonBrand) ? entry.baselineNonBrand : 0);
      upliftTotal += Number.isFinite(entry.uplift) ? entry.uplift : 0;
      monthCount += 1;
    }
    if (monthCount === 0) {
      return null;
    }
    const upliftPercent = baselineTotal > 0 ? upliftTotal / baselineTotal : 0;
    return {
      months: monthCount,
      baseline: baselineTotal,
      uplift: upliftTotal,
      upliftPercent,
    };
  }, [projectionChartData]);

  const categoryUpliftTotals = useMemo<Array<{ category: string; value: number }>>(() => {
    if (!upliftResults?.categoryUpliftByMonth?.length) {
      return [];
    }
    const totals = new Map<string, number>();
    for (const row of upliftResults.categoryUpliftByMonth) {
      const category = (row.category ?? "").trim() || "Uncategorized";
      const upliftValue = Number(row.uplift);
      if (!Number.isFinite(upliftValue) || upliftValue <= 0) {
        continue;
      }
      totals.set(category, (totals.get(category) ?? 0) + upliftValue);
    }
    return Array.from(totals.entries())
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value);
  }, [upliftResults?.categoryUpliftByMonth]);

  const categoryCircleNodes = useMemo<
    Array<{ category: string; value: number; x: number; y: number; r: number; color: string }>
  >(() => {
    if (categoryUpliftTotals.length === 0) {
      return [];
    }
    const root: CategoryHierarchyNode = {
      name: "root",
      children: categoryUpliftTotals.map((item) => ({
        name: item.category,
        value: item.value,
      })),
    };
    const packLayout = pack<CategoryHierarchyNode>()
      .size([400, 400])
      .padding(6);
    const hierarchyRoot = hierarchy<CategoryHierarchyNode>(root)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const leaves = packLayout(hierarchyRoot).leaves();
    return leaves.map((node, index) => ({
      category: node.data.name ?? `Category ${index + 1}`,
      value: node.value ?? 0,
      x: node.x,
      y: node.y,
      r: node.r,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));
  }, [categoryUpliftTotals]);

  const hasCategoryCircleData = categoryCircleNodes.length > 0;

  const keywordOpportunityRows = useMemo(() => {
    if (!upliftResults?.detailedProjections?.length) {
      return [] as Array<{
        keyword: string;
        averageVolume: number | null;
        difficulty: string;
        startRank: number | null;
        finalRank: number | null;
        shortTermUplift: number;
        totalUplift: number;
        salesUplift: number | null;
        revenueUplift: number | null;
        opportunityScore: number | null;
        quickWin: boolean;
      }>;
    }

    type MutableRow = {
      keyword: string;
      volumeSum: number;
      volumeCount: number;
      difficulty: string | null;
      startRank: number | null;
      finalRank: number | null;
      maxMonthAhead: number;
      shortTermUplift: number;
      totalUplift: number;
      salesUplift: number;
      revenueUplift: number;
      opportunityScore: number | null;
      quickWin: boolean;
    };

    const map = new Map<string, MutableRow>();

    for (const row of upliftResults.detailedProjections) {
      const keyword = typeof row.keyword === "string" ? row.keyword.trim() : "";
      if (!keyword) {
        continue;
      }

      let entry = map.get(keyword);
      if (!entry) {
        entry = {
          keyword,
          volumeSum: 0,
          volumeCount: 0,
          difficulty: row.difficulty && row.difficulty !== "N/A" ? row.difficulty : null,
          startRank: Number.isFinite(row.startRank) ? Number(row.startRank) : null,
          finalRank: Number.isFinite(row.predRank) ? Number(row.predRank) : null,
          maxMonthAhead: Number.isFinite(row.monthAhead) ? Number(row.monthAhead) : 0,
          shortTermUplift: 0,
          totalUplift: 0,
          salesUplift: 0,
          revenueUplift: 0,
          opportunityScore: Number.isFinite(row.opportunityScore) ? Number(row.opportunityScore) : null,
          quickWin: Boolean(row.quickWin),
        };
        map.set(keyword, entry);
      }

      if (Number.isFinite(row.volume)) {
        entry.volumeSum += Number(row.volume);
        entry.volumeCount += 1;
      }

      if (!entry.difficulty && row.difficulty && row.difficulty !== "N/A") {
        entry.difficulty = row.difficulty;
      }

      if (Number.isFinite(row.startRank)) {
        const currentStart = Number(row.startRank);
        entry.startRank = entry.startRank == null ? currentStart : Math.min(entry.startRank, currentStart);
      }

      if (Number.isFinite(row.predRank) && Number.isFinite(row.monthAhead)) {
        const monthAhead = Number(row.monthAhead);
        if (monthAhead >= entry.maxMonthAhead) {
          entry.maxMonthAhead = monthAhead;
          entry.finalRank = Number(row.predRank);
        }
      }

      if (Number.isFinite(row.expUplift)) {
        const upliftValue = Number(row.expUplift);
        entry.totalUplift += upliftValue;

        if (Number.isFinite(row.monthAhead)) {
          const monthAhead = Number(row.monthAhead);
          if (monthAhead >= 1 && monthAhead <= 3) {
            entry.shortTermUplift += upliftValue;
          }
        }

        if (hasEcommerceMetrics) {
          const estimatedSales = upliftValue * conversionRateDecimal;
          entry.salesUplift += estimatedSales;
          entry.revenueUplift += estimatedSales * averageOrderValue;
        }
      }

      if (Number.isFinite(row.opportunityScore)) {
        const score = Number(row.opportunityScore);
        if (Number.isFinite(row.monthAhead) && Number(row.monthAhead) === 1) {
          entry.opportunityScore = score;
        } else if (entry.opportunityScore == null) {
          entry.opportunityScore = score;
        }
      }

      if (row.quickWin) {
        entry.quickWin = true;
      }
    }

    return Array.from(map.values())
      .map((entry) => ({
        keyword: entry.keyword,
        averageVolume: entry.volumeCount > 0 ? entry.volumeSum / entry.volumeCount : null,
        difficulty: entry.difficulty ?? "N/A",
        startRank: entry.startRank,
        finalRank: entry.finalRank,
        shortTermUplift: entry.shortTermUplift,
        totalUplift: entry.totalUplift,
        salesUplift: hasEcommerceMetrics ? entry.salesUplift : null,
        revenueUplift: hasEcommerceMetrics ? entry.revenueUplift : null,
        opportunityScore: entry.opportunityScore,
        quickWin: entry.quickWin,
      }))
      .sort((a, b) => {
        const aValue = Number.isFinite(a.totalUplift) ? a.totalUplift : 0;
        const bValue = Number.isFinite(b.totalUplift) ? b.totalUplift : 0;
        return bValue - aValue;
      });
  }, [upliftResults?.detailedProjections, hasEcommerceMetrics, conversionRateDecimal, averageOrderValue]);

  const summaryCards: SummaryCardProps[] = [
    {
      title: "Historic Sessions",
      description: "Last 12 months",
      sessionsDisplay: formatNumber(lastTwelveMonthsTotals.sessions),
      transactionsDisplay: formatNumber(lastTwelveMonthsTotals.transactions),
      revenueDisplay: formatCurrency(lastTwelveMonthsTotals.revenue),
    },
    {
      title: "Projected Baselines",
      description: projectionMonths > 0 ? `${projectionMonths} month Prophet horizon` : "Prophet projection horizon",
      sessionsDisplay: formatNumber(projectedBaselineSessions),
      transactionsDisplay: formatNumber(hasEcommerceMetrics ? baselineTransactions : null),
      revenueDisplay: formatCurrency(hasEcommerceMetrics ? baselineRevenue : null),
    },
    {
      title: "Potential Uplifts",
      description: "Keyword uplift totals",
      highlight: true,
      sessionsDisplay: formatNumber(
        upliftResults?.totalUpliftSum ?? null,
        upliftResults && upliftResults.totalUpliftSum > 0 ? "+" : "",
      ),
      transactionsDisplay: formatNumber(
        hasEcommerceMetrics ? upliftTransactions : null,
        hasEcommerceMetrics && upliftTransactions != null && upliftTransactions > 0 ? "+" : "",
      ),
      revenueDisplay: formatCurrency(
        hasEcommerceMetrics ? upliftRevenue : null,
        hasEcommerceMetrics && upliftRevenue != null && upliftRevenue > 0 ? "+" : "",
      ),
    },
  ];

  const ecommerceFootnote = hasEcommerceMetrics
    ? `Transactions and revenue estimates use the current GA conversion rate (${conversionRatePct.toFixed(
        2,
      )}%) and average order value (${standardCurrencyFormatter.format(averageOrderValue)}).`
    : "Connect an ecommerce-enabled GA property with conversion rate and average order value to unlock transaction and revenue estimates.";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organic Opportunity Results</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            These results show at a top level the potential behind each keyword category, and of growth at a per-keyword
            level. Values here are inferred from recent organic performance and are for illustrative purposes only.
            <br />
            <strong className="font-semibold text-foreground">
              These results should provide guidance on which topics are likely to be most beneficial, and what the uplift
              is in comparison to current norms.
            </strong>
          </p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <Button
            onClick={handleDownloadExcel}
            disabled={isDownloadingExcel}
            className="inline-flex items-center gap-2 self-start md:self-auto"
          >
            {isDownloadingExcel ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Generating workbook...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" aria-hidden="true" />
                Download Excel Workbook
              </>
            )}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground md:text-right">
            Creates a multi-tab workbook with uplift summaries, keyword projections, Prophet outputs, and traffic
            references.
          </p>
        </div>
      </div>

      {isStatusLoading ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 py-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Checking prerequisite workflow steps...</p>
          </CardContent>
        </Card>
      ) : missingPrerequisites.length > 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Complete the earlier workflow steps to unlock the organic results dashboard.
            </p>
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Still required:</span>{" "}
              {missingPrerequisites.join(" Â· ")}
            </div>
          </CardContent>
        </Card>
      ) : isLoadingGaReport ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 py-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Fetching Google Analytics metricsâ€¦</p>
          </CardContent>
        </Card>
      ) : hasGaReportError || !gaReport ? (
        <Card className="border border-destructive/50 border-dashed">
          <CardContent className="space-y-3 py-8 text-center">
            <p className="font-semibold text-destructive">Unable to retrieve Google Analytics results.</p>
            <p className="text-sm text-muted-foreground">
              Return to the Google Analytics step and refresh the property connection to try again.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {summaryCards.map((card) => (
              <SummaryCard key={card.title} {...card} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{ecommerceFootnote}</p>
          <div className="grid gap-6">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Monthly Projection</CardTitle>
                <CardDescription>Monthly sessions, transactions, and revenue outlook.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      Projected {activeProjectionMetricLower}
                    </p>
                    <div className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 p-1">
                      {projectionMetricChoices.map((metric) => (
                        <button
                          key={metric}
                          type="button"
                          onClick={() => setProjectionMetric(metric)}
                          className={`rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                            projectionMetric === metric
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {PROJECTION_METRIC_LABEL[metric]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-72">
                    {monthlyProjectionBase.length === 0 ? (
                      <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                        Monthly projections will appear once Prophet results are available.
                      </div>
                    ) : !projectionChartHasData ? (
                      <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                        Generate uplift projections to populate this view.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={projectionChartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" minTickGap={32} tickFormatter={formatMonthLabel} />
                          <YAxis tickFormatter={projectionTickFormatter} />
                          <RechartsTooltip
                            labelFormatter={(value) => formatMonthLabel(String(value))}
                            formatter={(value) => {
                              const numeric = typeof value === "number" ? value : Number(value);
                              if (!Number.isFinite(numeric)) {
                                return null;
                              }
                              return [projectionTooltipFormatter(numeric), undefined];
                            }}
                            filterNull
                          />
                          <Bar
                            dataKey="actual"
                            name={`Actual ${activeProjectionMetricLower}`}
                            stackId="projection"
                            fill="#6366F1"
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="baselineBrand"
                            name={`Projected brand ${activeProjectionMetricLower}`}
                            stackId="projection"
                            fill="#A855F7"
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="baselineNonBrand"
                            name={`Projected non-brand ${activeProjectionMetricLower}`}
                            stackId="projection"
                            fill="#38BDF8"
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="uplift"
                            name={`Projected uplift ${activeProjectionMetricLower}`}
                            stackId="projection"
                            fill="#F97316"
                            isAnimationActive={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
                {projectionSummary ? (
                  <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {formatProjectionValue(projectionSummary.uplift, true)}
                    </span>{" "}
                    projected {activeProjectionMetricLower} uplift over{" "}
                    <span className="font-semibold text-foreground">
                      {projectionSummary.months} {projectionSummary.months === 1 ? "month" : "months"}
                    </span>
                    , lifting the total to{" "}
                    <span className="font-semibold text-foreground">
                      {formatProjectionValue(projectionSummary.baseline + projectionSummary.uplift)}
                    </span>{" "}
                    ({(projectionSummary.upliftPercent * 100).toFixed(1)}% above the baseline forecast).
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border/50 p-3 text-sm text-muted-foreground">
                    Additional uplift data will appear once projections are complete.
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Opportunity by Keyword Group</CardTitle>
                <CardDescription>Compare potential impact by keyword category.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Hover over each circle to inspect projected uplift by category.
                </p>
                <div className="flex w-full justify-center">
                  {hasCategoryCircleData ? (
                    <svg
                      viewBox="0 0 400 400"
                      className="h-80 w-full max-w-xl rounded-full bg-white"
                      role="img"
                      aria-label="Projected uplift by keyword category"
                    >
                      {categoryCircleNodes.map((node) => {
                        const showLabel = node.r > 28;
                        const showValue = node.r > 40;
                        const fontSize = Math.min(18, Math.max(11, node.r / 3));
                        const valueLabel = compactNumberFormatter.format(Math.round(node.value));
                        return (
                          <g key={node.category} transform={`translate(${node.x} ${node.y})`}>
                            <circle cx={0} cy={0} r={node.r} fill={node.color} fillOpacity={0.85} />
                            <title>{`${node.category}: ${valueLabel} uplift`}</title>
                            {showLabel ? (
                              <text
                                x={0}
                                y={showValue ? -fontSize / 4 : 0}
                                textAnchor="middle"
                                dominantBaseline={showValue ? "auto" : "middle"}
                                fill="#111827"
                                fontSize={fontSize}
                                fontWeight={600}
                                pointerEvents="none"
                              >
                                {node.category}
                              </text>
                            ) : null}
                            {showValue ? (
                              <text
                                x={0}
                                y={fontSize}
                                textAnchor="middle"
                                fill="#1F2937"
                                fontSize={Math.max(10, fontSize * 0.8)}
                                pointerEvents="none"
                              >
                                {valueLabel}
                              </text>
                            ) : null}
                          </g>
                        );
                      })}
                    </svg>
                  ) : (
                    <div className="flex h-80 w-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                      Category uplift insights will appear once projections are available.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Keyword Potentials</CardTitle>
              <CardDescription>Detailed keyword-level opportunity table.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[480px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50 text-xs uppercase tracking-wide">
                    <th className="py-2 pr-4 font-medium">Keyword</th>
                    <th className="py-2 pr-4 font-medium">Avg. volume</th>
                    <th className="py-2 pr-4 font-medium">Difficulty</th>
                    <th className="py-2 pr-4 font-medium">Position</th>
                    <th className="py-2 pr-4 font-medium">Final position</th>
                    <th className="py-2 pr-4 font-medium">Short uplift</th>
                    <th className="py-2 pr-4 font-medium">Total uplift</th>
                    <th className="py-2 pr-4 font-medium">Sales uplift</th>
                    <th className="py-2 pr-4 font-medium">Revenue uplift</th>
                    <th className="py-2 pr-4 text-center font-medium">Opportunity</th>
                    <th className="py-2 pr-4 text-center font-medium">Quick win</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {keywordOpportunityRows.length === 0 ? (
                    <tr>
                      <td className="py-6 text-center text-muted-foreground" colSpan={11}>
                        Keyword uplift projections will appear here once the uplift calculator has been run.
                      </td>
                    </tr>
                  ) : (
                    keywordOpportunityRows.map((row) => {
                      const averageVolumeDisplay =
                        row.averageVolume != null && Number.isFinite(row.averageVolume)
                          ? integerFormatter.format(Math.round(row.averageVolume))
                          : "--";
                      const startRankDisplay =
                        row.startRank != null && Number.isFinite(row.startRank)
                          ? rankFormatter.format(row.startRank)
                          : "--";
                      const finalRankDisplay =
                        row.finalRank != null && Number.isFinite(row.finalRank)
                          ? rankFormatter.format(row.finalRank)
                          : "--";
                      const shortTermUpliftDisplay = formatNumber(
                        row.shortTermUplift,
                        row.shortTermUplift > 0 ? "+" : "",
                      );
                      const totalUpliftDisplay = formatNumber(
                        row.totalUplift,
                        row.totalUplift > 0 ? "+" : "",
                      );
                      const salesUpliftDisplay =
                        row.salesUplift != null
                          ? formatNumber(row.salesUplift, row.salesUplift > 0 ? "+" : "")
                          : "--";
                      const revenueUpliftDisplay =
                        row.revenueUplift != null
                          ? formatCurrency(row.revenueUplift, row.revenueUplift > 0 ? "+" : "")
                          : "--";
                      const normalizedScore =
                        row.opportunityScore != null && Number.isFinite(row.opportunityScore)
                          ? Math.round(row.opportunityScore)
                          : null;
                      const clampedScore =
                        normalizedScore != null ? Math.max(0, Math.min(10, normalizedScore)) : null;
                      const ScoreIcon = clampedScore != null ? OPPORTUNITY_SCORE_ICON[clampedScore] ?? CounterZero : null;
                      const difficultyClass =
                        DIFFICULTY_COLORS[row.difficulty.toLowerCase()] ?? "text-muted-foreground";

                      return (
                        <tr key={row.keyword}>
                          <td className="py-3 pr-4 font-medium text-foreground">{row.keyword}</td>
                          <td className="py-3 pr-4">{averageVolumeDisplay}</td>
                          <td className="py-3 pr-4">{row.difficulty}</td>
                          <td className="py-3 pr-4">{startRankDisplay}</td>
                          <td className="py-3 pr-4">{finalRankDisplay}</td>
                          <td className="py-3 pr-4">{shortTermUpliftDisplay}</td>
                          <td className="py-3 pr-4">{totalUpliftDisplay}</td>
                          <td className="py-3 pr-4">{salesUpliftDisplay}</td>
                          <td className="py-3 pr-4">{revenueUpliftDisplay}</td>
                          <td className="py-3 pr-4 text-center">
                            {ScoreIcon ? (
                              <ScoreIcon
                                className={`h-5 w-5 ${difficultyClass}`}
                                aria-label={
                                  clampedScore != null
                                    ? `Opportunity score ${clampedScore}`
                                    : "Opportunity score unavailable"
                                }
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">--</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-center">
                            {row.quickWin ? (
                              <OfflineBolt className="h-5 w-5 text-emerald-500" aria-label="Quick win keyword" />
                            ) : (
                              <span className="text-xs text-muted-foreground">--</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
