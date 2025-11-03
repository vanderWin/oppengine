import { useEffect, useMemo, useRef, useState } from "react";
import { OAuthConnectionCard } from "@/components/OAuthConnectionCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/MetricCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Globe, RefreshCw } from "lucide-react";
import { SearchInsights as SearchInsightsIcon } from "@nine-thirty-five/material-symbols-react/outlined";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GSCHeadlineMetrics, GSCReportResponse } from "@shared/schema";
import { useLocation } from "wouter";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface GSCSite {
  siteUrl: string;
  permissionLevel: string;
}

interface GoogleStatus {
  ga: {
    connected: boolean;
    hasTokens: boolean;
  };
  gsc: {
    connected: boolean;
    hasTokens: boolean;
    selectedSite: { siteUrl: string } | null;
    brandTerms: string[];
    reportSummary:
      | {
          siteUrl: string;
          brandTerms: string[];
          fetchedAt: string;
          headline: GSCHeadlineMetrics;
        }
      | null;
  };
}

function parseBrandTerms(input: string): string[] {
  return input
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

interface StackedAreaChartProps {
  data: Array<{
    date: string;
    brandClicks: number;
    nonBrandClicks: number;
    anonymousClicks: number;
  }>;
  numberFormatter: Intl.NumberFormat;
}

function StackedAreaChart({ data, numberFormatter }: StackedAreaChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Clicks by Brand Classification</CardTitle>
        <CardDescription>Historic performance for up to 16 months</CardDescription>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              minTickGap={32}
              tickFormatter={(value: string) => {
                const date = new Date(`${value}T00:00:00`);
                return Number.isNaN(date.getTime())
                  ? value
                  : date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
              }}
            />
            <YAxis />
            <Tooltip
              formatter={(value: number, name) => [numberFormatter.format(value), name]}
              labelFormatter={(value: string) => {
                const date = new Date(`${value}T00:00:00`);
                return Number.isNaN(date.getTime())
                  ? value
                  : date.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    });
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="brandClicks"
              stackId="1"
              stroke="#2B0573"
              fill="#2B0573"
              fillOpacity={0.85}
              name="Brand clicks"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="nonBrandClicks"
              stackId="1"
              stroke="#E859FF"
              fill="#E859FF"
              fillOpacity={0.60}
              name="Non-brand clicks"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="anonymousClicks"
              stackId="1"
              stroke="#94a3b8"
              fill="#cbd5f5"
              name="Anonymous clicks"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function SearchConsole() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isConnected, setIsConnected] = useState(false);
  const [pendingSite, setPendingSite] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [brandInput, setBrandInput] = useState("");
  const [report, setReport] = useState<GSCReportResponse | null>(null);
  const lastFetchedSite = useRef<string | null>(null);

  const { data: status } = useQuery<GoogleStatus>({
    queryKey: ["/api/google/status"],
  });

  const { data: sitesData, isLoading: isLoadingSites } = useQuery<{ sites: GSCSite[] }>({
    queryKey: ["/api/google/gsc/sites"],
    enabled: isConnected,
  });

  useEffect(() => {
    setIsConnected(status?.gsc?.connected || false);
  }, [status]);

  useEffect(() => {
    if (!status?.gsc?.connected) {
      setPendingSite(null);
      setBrandInput("");
      setReport(null);
      lastFetchedSite.current = null;
      return;
    }

    if (status.gsc.brandTerms.length > 0) {
      setBrandInput(status.gsc.brandTerms.join(", "));
    }
  }, [status?.gsc?.connected, status?.gsc?.brandTerms]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "oauth-success" && event.data?.service === "gsc") {
        queryClient.invalidateQueries({ queryKey: ["/api/google/status"] });
      } else if (event.data?.type === "oauth-error") {
        console.error("OAuth error:", event.data.error);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/google/gsc/disconnect", { method: "POST" });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google/status"] });
      setIsConnected(false);
      setPendingSite(null);
      setBrandInput("");
      setReport(null);
      lastFetchedSite.current = null;
    },
  });

  const selectSiteMutation = useMutation({
    mutationFn: async (siteUrl: string) => {
      return await apiRequest("POST", "/api/google/gsc/select-site", { siteUrl });
    },
    onSuccess: (_data, siteUrl) => {
      toast({
        title: "Site selected",
        description: `${siteUrl} is now your active Search Console property`,
      });
      setPendingSite(null);
      setReport(null);
      lastFetchedSite.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/google/status"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save site selection",
        variant: "destructive",
      });
    },
  });

  const fetchReportMutation = useMutation<GSCReportResponse, Error, { brandTerms: string[]; forceRefresh?: boolean }>(
    {
      mutationFn: async ({ brandTerms, forceRefresh }) => {
        const payload: Record<string, unknown> = { brandTerms };
        if (forceRefresh) {
          payload.forceRefresh = true;
        }
        const response = await apiRequest("POST", "/api/google/gsc/report", payload);
        return (await response.json()) as GSCReportResponse;
      },
      onSuccess: (data) => {
        setReport(data);
        lastFetchedSite.current = data.siteUrl;
        queryClient.invalidateQueries({ queryKey: ["/api/google/status"] });
        toast({
          title: "Search Console data ready",
          description: data.fromCache
            ? "Loaded from cache for faster access."
            : "Fetched the latest Search Console data.",
        });
      },
      onError: (error) => {
        toast({
          title: "Failed to fetch Search Console data",
          description: error.message,
          variant: "destructive",
        });
      },
    }
  );

  useEffect(() => {
    if (!status?.gsc?.selectedSite?.siteUrl || fetchReportMutation.isPending) {
      return;
    }

    const siteUrl = status.gsc.selectedSite.siteUrl;
    const alreadyLoaded = report && report.siteUrl === siteUrl;
    if (alreadyLoaded || lastFetchedSite.current === siteUrl) {
      return;
    }

    lastFetchedSite.current = siteUrl;
    const initialBrandTerms =
      status.gsc.brandTerms.length > 0 ? status.gsc.brandTerms : parseBrandTerms(brandInput);

    fetchReportMutation.mutate({ brandTerms: initialBrandTerms });
  }, [status?.gsc?.selectedSite?.siteUrl]);

  const handleConnect = () => {
    window.open("/api/google/gsc/authorize", "google-oauth", "width=500,height=600");
  };

  const handleDisconnect = () => {
    disconnectMutation.mutate();
  };

  const handleConfirmSite = () => {
    if (!pendingSite) {
      return;
    }
    selectSiteMutation.mutate(pendingSite);
  };

  const handleGenerateReport = (forceRefresh: boolean) => {
    if (!status?.gsc?.selectedSite?.siteUrl) {
      toast({
        title: "Select a site first",
        description: "Choose a Search Console property before requesting data.",
      });
      return;
    }
    const terms = parseBrandTerms(brandInput);
    fetchReportMutation.mutate({ brandTerms: terms, forceRefresh });
  };

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }),
    []
  );
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }),
    []
  );

  const chartData = useMemo(
    () =>
      report?.rows.map((row) => ({
        date: row.date,
        brandClicks: row.brandClicks,
        nonBrandClicks: row.nonBrandClicks,
        anonymousClicks: row.anonymousClicks,
      })) ?? [],
    [report]
  );

  const topNonBrandQueries = useMemo(
    () => (report?.nonBrandQueries ?? []).slice(0, 15),
    [report]
  );

  const ctrByPositionData = useMemo(
    () =>
      (report?.nonBrandCtrByPosition ?? []).map((row) => ({
        position: row.position,
        ctr: row.ctr,
        clicks: row.clicks,
        impressions: row.impressions,
      })),
    [report]
  );

  const summary = report?.headline;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
            <SearchInsightsIcon className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Google Search Console</h1>
            <p className="text-muted-foreground mt-1">
              Split organic clicks into brand, non-brand, and anonymous demand over the last 16 months
            </p>
          </div>
        </div>
        {isConnected && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleGenerateReport(true)}
            disabled={fetchReportMutation.isPending}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh data
          </Button>
        )}
      </div>

      <OAuthConnectionCard
        service="Google Search Console"
        description="Fetch search analytics data for the last 16 months"
        isConnected={isConnected}
        connectedEmail={undefined}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRefresh={() => handleGenerateReport(true)}
      />

      {isConnected && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Select Search Console Site</CardTitle>
              <CardDescription>Choose the verified property you want to analyse</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingSites ? (
                <div className="py-8 text-center text-muted-foreground">Loading sites...</div>
              ) : sitesData?.sites && sitesData.sites.length > 0 ? (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search sites..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="pl-9"
                      data-testid="input-search-sites"
                    />
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {sitesData.sites
                      .filter((site) => site.siteUrl.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map((site) => (
                        <button
                          key={site.siteUrl}
                          onClick={() => setPendingSite(site.siteUrl)}
                          className={`w-full text-left p-4 rounded-lg border transition-colors hover-elevate ${
                            (pendingSite || status?.gsc?.selectedSite?.siteUrl) === site.siteUrl
                              ? "border-primary bg-accent"
                              : "border-border"
                          }`}
                          data-testid={`button-select-site-${site.siteUrl}`}
                        >
                          <div className="flex items-start gap-3">
                            <Globe className="h-5 w-5 mt-0.5 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{site.siteUrl}</div>
                              <div className="text-sm text-muted-foreground">{site.permissionLevel}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                  </div>
                  {sitesData.sites.filter((site) => site.siteUrl.toLowerCase().includes(searchQuery.toLowerCase()))
                    .length === 0 && (
                    <div className="py-4 text-center text-muted-foreground">No sites match your search</div>
                  )}
                  {pendingSite && (
                    <Button
                      className="w-full mt-4"
                      onClick={handleConfirmSite}
                      disabled={selectSiteMutation.isPending}
                      data-testid="button-confirm-site"
                    >
                      {selectSiteMutation.isPending ? "Saving..." : "Continue with selected site"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No verified sites found. Add and verify a property in Google Search Console first.
                </div>
              )}
            </CardContent>
          </Card>

          {status?.gsc?.selectedSite ? (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Brand term configuration</CardTitle>
                  <CardDescription>
                    Enter brand keywords to separate branded and non-branded demand. Use commas to add multiple terms.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground" htmlFor="brand-terms">
                      Brand keywords
                    </label>
                    <Input
                      id="brand-terms"
                      placeholder="e.g. oppengine, opp engine, opp engine services"
                      value={brandInput}
                      onChange={(event) => setBrandInput(event.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => handleGenerateReport(false)}
                      disabled={fetchReportMutation.isPending}
                      data-testid="button-generate-gsc-report"
                    >
                      {fetchReportMutation.isPending ? "Fetching..." : "Generate insights"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleGenerateReport(true)}
                      disabled={fetchReportMutation.isPending}
                    >
                      {fetchReportMutation.isPending ? "Refreshing..." : "Force refresh"}
                    </Button>
                  </div>
                  {status.gsc.reportSummary && (
                    <p className="text-sm text-muted-foreground">
                      Last fetched on {new Date(status.gsc.reportSummary.fetchedAt).toLocaleString()} using brand terms:{" "}
                      {status.gsc.reportSummary.brandTerms.length > 0
                        ? status.gsc.reportSummary.brandTerms.join(", ")
                        : "none"}
                    </p>
                  )}
                </CardContent>
              </Card>

              {fetchReportMutation.isPending && !report && (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Fetching Search Console data...
                  </CardContent>
                </Card>
              )}

              {report && summary && (
                <>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <MetricCard
                      title="Total clicks"
                      value={numberFormatter.format(summary.totalClicks)}
                      subtitle={`${report.startDate} to ${report.endDate}`}
                    />
                    <MetricCard
                      title="Total brand clicks"
                      value={numberFormatter.format(summary.totalBrandClicks)}
                    />
                    <MetricCard
                      title="Total non-brand clicks"
                      value={numberFormatter.format(summary.totalNonBrandClicks)}
                    />
                    <MetricCard
                      title="90 day brand share"
                      value={`${percentFormatter.format(summary.ninetyDayBrandShare)}%`}
                      subtitle={`${summary.startDate} to ${summary.endDate}`}
                    />
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Reporting window</CardTitle>
                      <CardDescription>
                        Clicks aggregated from {report.startDate} to {report.endDate}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground space-y-1">
                      <div>
                        <span className="font-semibold text-foreground">Selected site:</span>{" "}
                        {report.siteUrl}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Brand keywords:</span>{" "}
                        {report.brandTerms.length > 0 ? report.brandTerms.join(", ") : "None"}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Last generated:</span>{" "}
                        {new Date(report.generatedAt).toLocaleString()}
                        {report.fromCache ? " (cached)" : ""}
                      </div>
                    </CardContent>
                  </Card>

                  <StackedAreaChart data={chartData} numberFormatter={numberFormatter} />

                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Top non-brand queries</CardTitle>
                        <CardDescription>Last 90 days, ordered by clicks</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {topNonBrandQueries.length > 0 ? (
                          <div className="max-h-80 overflow-y-auto pr-1">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Query</TableHead>
                                  <TableHead className="text-right">Clicks</TableHead>
                                  <TableHead className="text-right">Impressions</TableHead>
                                  <TableHead className="text-right">CTR</TableHead>
                                  <TableHead className="text-right">Avg. position</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {topNonBrandQueries.map((row) => (
                                  <TableRow key={row.query}>
                                    <TableCell className="max-w-[220px] truncate">
                                      {row.query}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {numberFormatter.format(row.clicks)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {numberFormatter.format(row.impressions)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {`${percentFormatter.format(row.ctr * 100)}%`}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {row.position.toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <div className="py-6 text-center text-muted-foreground">
                            No query data available for the selected configuration.
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Non-brand CTR by position</CardTitle>
                        <CardDescription>Rounded average position vs. calculated CTR</CardDescription>
                      </CardHeader>
                      <CardContent className="h-80">
                        {ctrByPositionData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={ctrByPositionData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="position" />
                              <YAxis
                                tickFormatter={(value) => `${percentFormatter.format(value * 100)}%`}
                              />
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (!active || !payload || payload.length === 0) {
                                    return null;
                                  }
                                  const point = payload[0].payload as {
                                    ctr: number;
                                    clicks: number;
                                    impressions: number;
                                  };
                                  return (
                                    <div className="rounded-md border bg-background p-2 text-sm shadow">
                                      <p className="font-medium">Position {label}</p>
                                      <p>CTR: {percentFormatter.format(point.ctr * 100)}%</p>
                                      <p>Clicks: {numberFormatter.format(point.clicks)}</p>
                                      <p>Impressions: {numberFormatter.format(point.impressions)}</p>
                                    </div>
                                  );
                                }}
                              />
                              <Legend />
                              <Line
                                type="natural"
                                dataKey="ctr"
                                stroke="#00A3B8"
                                strokeWidth={2}
                                dot={{ r: 3 }}
                                name="CTR"
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="py-6 text-center text-muted-foreground">
                            Not enough position data to calculate CTR.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}

              {!fetchReportMutation.isPending && !report && (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Generate a report to view brand vs. non-brand performance.
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Select a Search Console site above to begin analysing brand demand.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {ctrByPositionData.length > 0 && !fetchReportMutation.isPending && (
        <div className="flex justify-end pt-8">
          <Button
            size="lg"
            onClick={() => navigate("/prophet")}
            className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 animate-cta-pulse gap-2 border-0"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              arrow_circle_down
            </span>
            Proceed to Next Phase
          </Button>
        </div>
      )}
    </div>
  );
}
