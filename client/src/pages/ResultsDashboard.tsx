import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GAReportResponse, ProjectionResults } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const PROPHET_STORAGE_KEY = "prophet/state";
const UPLIFT_STORAGE_KEY = "uplift/state";

interface CombinedSessionsDatum {
  date: string;
  monthKey: string;
  actualSessions: number;
  scaledBrand: number;
  scaledNonBrand: number;
  isForecast: boolean;
}

interface ProphetStoredResults {
  combinedSessions: CombinedSessionsDatum[];
}

interface ProphetPersistedState {
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
  accentColor: string;
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
  accentColor,
}: SummaryCardProps) {
  const sessionsUnavailable = sessionsDisplay === "—";
  const transactionsUnavailable = transactionsDisplay === "—";
  const revenueUnavailable = revenueDisplay === "—";

  return (
    <Card className="h-full">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <span className={`h-2 w-2 rounded-full ${accentColor}`} aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div>
          <div className={`text-3xl font-semibold ${sessionsUnavailable ? "text-muted-foreground" : ""}`}>
            {sessionsDisplay}
          </div>
          <p className="text-sm text-muted-foreground">Sessions</p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground" aria-hidden="true">
              shopping_cart_checkout
            </span>
            <span className={`font-semibold ${transactionsUnavailable ? "text-muted-foreground" : ""}`}>
              {transactionsDisplay}
            </span>
            <span className="text-muted-foreground">Transactions</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground" aria-hidden="true">
              money_bag
            </span>
            <span className={`font-semibold ${revenueUnavailable ? "text-muted-foreground" : ""}`}>
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
  const [hydratedProphet] = useState<ProphetPersistedState | null>(() => readProphetState());
  const [hydratedUplift] = useState<UpliftPersistedState | null>(() => readUpliftState());

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

  const formatNumber = useCallback(
    (value: number | null | undefined, prefix = "") => {
      if (value == null || !Number.isFinite(value)) {
        return "—";
      }
      return `${prefix}${compactNumberFormatter.format(value)}`;
    },
    [compactNumberFormatter],
  );

  const formatCurrency = useCallback(
    (value: number | null | undefined, prefix = "") => {
      if (value == null || !Number.isFinite(value)) {
        return "—";
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

  const summaryCards: SummaryCardProps[] = [
    {
      title: "Historic Sessions / Transactions / Revenue",
      description: "Last 12 months",
      sessionsDisplay: formatNumber(lastTwelveMonthsTotals.sessions),
      transactionsDisplay: formatNumber(lastTwelveMonthsTotals.transactions),
      revenueDisplay: formatCurrency(lastTwelveMonthsTotals.revenue),
      accentColor: "bg-slate-500",
    },
    {
      title: "Projected Baseline Sessions / Transactions / Revenue",
      description: projectionMonths > 0 ? `${projectionMonths} month Prophet horizon` : "Prophet projection horizon",
      sessionsDisplay: formatNumber(projectedBaselineSessions),
      transactionsDisplay: formatNumber(hasEcommerceMetrics ? baselineTransactions : null),
      revenueDisplay: formatCurrency(hasEcommerceMetrics ? baselineRevenue : null),
      accentColor: "bg-sky-500",
    },
    {
      title: "Potential Session Uplift / Transactions / Revenue",
      description: "Keyword uplift totals",
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
      accentColor: "bg-amber-500",
    },
  ];

  const ecommerceFootnote = hasEcommerceMetrics
    ? `Transactions and revenue estimates use the current GA conversion rate (${conversionRatePct.toFixed(
        2,
      )}%) and average order value (${standardCurrencyFormatter.format(averageOrderValue)}).`
    : "Connect an ecommerce-enabled GA property with conversion rate and average order value to unlock transaction and revenue estimates.";

  return (
    <div className="space-y-6">
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
              {missingPrerequisites.join(" · ")}
            </div>
          </CardContent>
        </Card>
      ) : isLoadingGaReport ? (
        <Card className="border-dashed">
          <CardContent className="space-y-3 py-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Fetching Google Analytics metrics…</p>
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
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Monthly Projection</CardTitle>
                <CardDescription>Monthly sessions, transactions, and revenue outlook.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex h-56 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  Chart placeholder
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="font-medium text-foreground">Upcoming Month Summary</span>
                    <span className="text-muted-foreground">TBD</span>
                  </div>
                  <p className="text-muted-foreground">
                    This section will surface the highlighted metrics for the next months once projections are wired up.
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Opportunity by Keyword Group</CardTitle>
                <CardDescription>Compare potential impact by keyword category.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex h-56 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  Category chart placeholder
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>Summary insights about the top keyword groups will appear here.</p>
                  <p>Use this space to call out where the biggest gains are expected.</p>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Keyword Potentials</CardTitle>
              <CardDescription>Detailed keyword-level opportunity table.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50 text-xs uppercase tracking-wide">
                    <th className="py-2 pr-4 font-medium">Keyword</th>
                    <th className="py-2 pr-4 font-medium">Current Rank</th>
                    <th className="py-2 pr-4 font-medium">Projected Sessions</th>
                    <th className="py-2 pr-4 font-medium">Projected Transactions</th>
                    <th className="py-2 pr-4 font-medium">Projected Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  <tr>
                    <td className="py-3 pr-4 text-muted-foreground">Keyword placeholder</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 text-muted-foreground">Keyword placeholder</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 text-muted-foreground">Keyword placeholder</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                    <td className="py-3 pr-4 text-muted-foreground">--</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
