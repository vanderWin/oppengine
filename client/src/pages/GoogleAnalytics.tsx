import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { OAuthConnectionCard } from "@/components/OAuthConnectionCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/MetricCard";
import { BarChart, Building2, RefreshCw, Search } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GAHeadlineMetrics, GAReportResponse } from "@shared/schema";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface GAProperty {
  name: string;
  displayName: string;
  accountName: string;
  accountDisplayName: string;
}

interface GoogleStatus {
  ga: {
    connected: boolean;
    hasTokens: boolean;
    selectedProperty: { name: string; displayName: string } | null;
    reportSummary:
      | {
          propertyId: string;
          propertyName: string;
          fetchedAt: string;
          headline90Day: GAHeadlineMetrics;
        }
      | null;
  };
  gsc: {
    connected: boolean;
    hasTokens: boolean;
  };
}

interface TimeSeriesChartProps {
  title: string;
  dataKey: "sessions" | "transactions" | "revenue";
  color: string;
  data: Array<{ date: string; sessions: number; transactions: number; revenue: number }>;
  valueFormatter: (value: number) => string;
}

type FetchReportVariables = {
  forceRefresh?: boolean;
};

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function TimeSeriesChart({ title, dataKey, color, data, valueFormatter }: TimeSeriesChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {/* <CardDescription>Historic performance for up to 50 months</CardDescription> */}
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatDateLabel} minTickGap={32} />
            <YAxis />
            <Tooltip
              labelFormatter={(label) => formatDateLabel(String(label))}
              formatter={(value: number) => [valueFormatter(value), title]}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function GoogleAnalytics() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isConnected, setIsConnected] = useState(false);
  const [pendingProperty, setPendingProperty] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [report, setReport] = useState<GAReportResponse | null>(null);
  const previousPropertyIdRef = useRef<string | null>(null);

  const { data: status } = useQuery<GoogleStatus>({
    queryKey: ["/api/google/status"],
  });

  const { data: propertiesData, isLoading: isLoadingProperties } = useQuery<{ properties: GAProperty[] }>({
    queryKey: ["/api/google/ga/properties"],
    enabled: isConnected,
  });

  useEffect(() => {
    setIsConnected(status?.ga?.connected || false);
  }, [status]);

  useEffect(() => {
    if (!status?.ga?.connected) {
      setPendingProperty(null);
      setReport(null);
      previousPropertyIdRef.current = null;
    }
  }, [status?.ga?.connected]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "oauth-success" && event.data?.service === "ga") {
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
      const response = await fetch("/api/google/ga/disconnect", { method: "POST" });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google/status"] });
      setIsConnected(false);
      setPendingProperty(null);
      setReport(null);
      previousPropertyIdRef.current = null;
    },
  });

  const fetchReportMutation = useMutation<GAReportResponse, Error, FetchReportVariables | undefined>({
    mutationFn: async (variables) => {
      const payload = variables?.forceRefresh ? { forceRefresh: true } : undefined;
      const response = await apiRequest("POST", "/api/google/ga/report", payload);
      return (await response.json()) as GAReportResponse;
    },
    onSuccess: (data) => {
      setReport(data);
      previousPropertyIdRef.current = data.propertyId;
      queryClient.invalidateQueries({ queryKey: ["/api/google/status"] });
      toast({
        title: "Google Analytics data ready",
        description: data.fromCache ? "Loaded from cache for faster access." : "Fresh data fetched successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to fetch Google Analytics data",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const selectPropertyMutation = useMutation({
    mutationFn: async (property: GAProperty) => {
      return await apiRequest("POST", "/api/google/ga/select-property", {
        propertyName: property.name,
        displayName: property.displayName,
      });
    },
    onSuccess: async (_data, variables) => {
      toast({
        title: "Property selected",
        description: `${variables.displayName} is now your active GA4 property`,
      });
      setPendingProperty(null);
      setReport(null);
      previousPropertyIdRef.current = null;
      await queryClient.invalidateQueries({ queryKey: ["/api/google/status"] });
      fetchReportMutation.mutate(undefined);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save property selection",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const selectedName = status?.ga?.selectedProperty?.name;
    if (!isConnected || !selectedName) {
      return;
    }
    const numericId = selectedName.split("/").pop() || selectedName;
    if (report && report.propertyId === numericId) {
      previousPropertyIdRef.current = numericId;
      return;
    }
    if (fetchReportMutation.isPending) {
      return;
    }
    if (previousPropertyIdRef.current !== numericId) {
      setReport(null);
    }
    previousPropertyIdRef.current = numericId;
    fetchReportMutation.mutate(undefined);
  }, [isConnected, status?.ga?.selectedProperty?.name]);

  const handleConnect = () => {
    window.open("/api/google/ga/authorize", "google-oauth", "width=500,height=600");
  };

  const handleDisconnect = () => {
    disconnectMutation.mutate();
  };

  const handleRefresh = (forceRefresh = false) => {
    if (!status?.ga?.selectedProperty) {
      toast({
        title: "Select a property first",
        description: "Choose a GA4 property to load analytics data.",
      });
      return;
    }
    if (forceRefresh) {
      previousPropertyIdRef.current = null;
    }
    fetchReportMutation.mutate(forceRefresh ? { forceRefresh: true } : undefined);
  };

  const handleContinue = () => {
    if (!pendingProperty) {
      return;
    }
    const property = propertiesData?.properties.find((item) => item.name === pendingProperty);
    if (property) {
      selectPropertyMutation.mutate(property);
    }
  };

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }),
    []
  );
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }),
    []
  );
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }),
    []
  );

  const chartData = useMemo(() => report?.rows ?? [], [report]);

  const highlightProperty =
    pendingProperty || status?.ga?.selectedProperty?.name || null;
  const headline = report?.headline90Day;
  const reportSummary = status?.ga?.reportSummary;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Google Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Connect your Google Analytics account to fetch historic organic traffic data
          </p>
        </div>
        {isConnected && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleRefresh(true)}
            disabled={fetchReportMutation.isPending}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh data
          </Button>
        )}
      </div>

      <OAuthConnectionCard
        service="Google Analytics 4"
        logo={<BarChart className="h-6 w-6 text-primary" />}
        description="Fetch organic session, transaction, and revenue data"
        isConnected={isConnected}
        connectedEmail={undefined}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRefresh={() => handleRefresh(true)}
      />

      {isConnected && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Select Google Analytics Property</CardTitle>
              <CardDescription>
                Choose the GA4 property you want to analyse
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingProperties ? (
                <div className="py-8 text-center text-muted-foreground">
                  Loading properties...
                </div>
              ) : propertiesData?.properties && propertiesData.properties.length > 0 ? (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search properties..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="pl-9"
                      data-testid="input-search-properties"
                    />
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {propertiesData.properties
                      .filter((property) => {
                        const query = searchQuery.toLowerCase();
                        return (
                          property.displayName?.toLowerCase().includes(query) ||
                          property.accountDisplayName?.toLowerCase().includes(query)
                        );
                      })
                      .map((property) => (
                        <button
                          key={property.name}
                          onClick={() => setPendingProperty(property.name)}
                          className={`w-full text-left p-4 rounded-lg border transition-colors hover-elevate ${
                            highlightProperty === property.name
                              ? "border-primary bg-accent"
                              : "border-border"
                          }`}
                          data-testid={`button-select-property-${property.name}`}
                        >
                          <div className="flex items-start gap-3">
                            <Building2 className="h-5 w-5 mt-0.5 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium">{property.displayName}</div>
                              <div className="text-sm text-muted-foreground truncate">
                                {property.accountDisplayName}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                  </div>
                  {propertiesData.properties.filter((property) => {
                    const query = searchQuery.toLowerCase();
                    return (
                      property.displayName?.toLowerCase().includes(query) ||
                      property.accountDisplayName?.toLowerCase().includes(query)
                    );
                  }).length === 0 && (
                    <div className="py-4 text-center text-muted-foreground">
                      No properties match your search.
                    </div>
                  )}
                  {pendingProperty && (
                    <Button
                      className="w-full mt-4"
                      onClick={handleContinue}
                      disabled={selectPropertyMutation.isPending}
                      data-testid="button-confirm-property"
                    >
                      {selectPropertyMutation.isPending ? "Saving..." : "Continue with Selected Property"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No GA4 properties found. Make sure your Google account has access to at least one GA4 property.
                </div>
              )}
            </CardContent>
          </Card>

          {status?.ga?.selectedProperty ? (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Selected property</CardTitle>
                  <CardDescription>
                    {status.ga.selectedProperty.displayName}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <div>
                    <span className="font-semibold text-foreground">API status:</span>{" "}
                    {fetchReportMutation.isPending ? "Fetching..." : report ? "Ready" : "Awaiting data"}
                  </div>
                  {reportSummary ? (
                    <>
                      <div>
                        <span className="font-semibold text-foreground">Last refreshed:</span>{" "}
                        {new Date(reportSummary.fetchedAt).toLocaleString()}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">90d sessions:</span>{" "}
                        {numberFormatter.format(reportSummary.headline90Day.totalSessions)}
                      </div>
                    </>
                  ) : (
                    <div>
                      Data will appear here after the first successful fetch.
                    </div>
                  )}
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => handleRefresh()}
                      disabled={fetchReportMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {fetchReportMutation.isPending ? "Refreshing..." : "Refresh now"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {fetchReportMutation.isPending && !report && (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    Fetching Google Analytics data...
                  </CardContent>
                </Card>
              )}

              {report && headline && (
                <>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    <MetricCard
                      title="90d Sessions"
                      value={numberFormatter.format(headline.totalSessions)}
                      subtitle={`${headline.startDate} to ${headline.endDate}`}
                    />
                    <MetricCard
                      title="90d Transactions"
                      value={numberFormatter.format(headline.totalTransactions)}
                      subtitle="Includes organic sessions only"
                    />
                    <MetricCard
                      title="90d Revenue"
                      value={currencyFormatter.format(headline.totalRevenue)}
                      subtitle="Transaction revenue"
                    />
                    <MetricCard
                      title="Average Order Value"
                      value={currencyFormatter.format(headline.averageOrderValue)}
                    />
                    <MetricCard
                      title="Conversion Rate"
                      value={`${percentFormatter.format(headline.conversionRate)}%`}
                    />
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Reporting window</CardTitle>
                      <CardDescription>
                        Organic performance captured from {report.startDate} to {report.endDate}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground space-y-1">
                      <div>
                        <span className="font-semibold text-foreground">Record count:</span>{" "}
                        {numberFormatter.format(report.rows.length)} daily rows
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Last generated:</span>{" "}
                        {new Date(report.generatedAt).toLocaleString()}
                        {report.fromCache ? " (cached)" : ""}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-6 lg:grid-cols-3">
                    <TimeSeriesChart
                      title="Organic Sessions"
                      dataKey="sessions"
                      color="#6366F1"
                      data={chartData}
                      valueFormatter={(value) => numberFormatter.format(value)}
                    />
                    <TimeSeriesChart
                      title="Organic Transactions"
                      dataKey="transactions"
                      color="#10B981"
                      data={chartData}
                      valueFormatter={(value) => numberFormatter.format(value)}
                    />
                    <TimeSeriesChart
                      title="Organic Revenue"
                      dataKey="revenue"
                      color="#F97316"
                      data={chartData}
                      valueFormatter={(value) => currencyFormatter.format(value)}
                    />
                  </div>
                </>
              )}

              {!fetchReportMutation.isPending && !report && (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    No Google Analytics data has been fetched yet. Refresh the data to populate the charts.
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Select a property above to begin fetching organic performance data.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {report && !fetchReportMutation.isPending && (
        <div className="flex justify-end pt-8">
          <Button
            size="lg"
            onClick={() => navigate("/gsc")}
            className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 animate-pulse gap-2"
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
