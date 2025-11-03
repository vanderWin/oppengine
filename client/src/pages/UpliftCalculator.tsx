import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { FileUploadZone } from "@/components/FileUploadZone";
import { ParameterPanel, DEFAULT_CTR_VALUES } from "@/components/ParameterPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle, TrendingUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { UpliftParameters, ProjectionResults, GSCReportResponse } from "@shared/schema";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { Button } from "@/components/ui/button";

interface GoogleStatus {
  gsc: {
    reportSummary: {
      brandTerms: string[];
    } | null;
  };
}

type SearchVolumeRegion = "UK" | "US";

interface UpliftPersistedState {
  keywordsUploaded: boolean;
  availableColumns: string[];
  csvData: any[];
  results: ProjectionResults | null;
  currentParameters: UpliftParameters | null;
  searchVolumeRegion?: SearchVolumeRegion;
  lastCalculatedSignature?: string | null;
}

const UPLIFT_STORAGE_KEY = "uplift/state";

function readUpliftStorage(): UpliftPersistedState | null {
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

function writeUpliftStorage(
  updater: (previous: UpliftPersistedState | null) => UpliftPersistedState | null,
): void {
  if (typeof window === "undefined") {
    return;
  }
  const previous = readUpliftStorage();
  const next = updater(previous);
  if (!next) {
    window.sessionStorage.removeItem(UPLIFT_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(UPLIFT_STORAGE_KEY, JSON.stringify(next));
}

export default function UpliftCalculator() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [rehydratedState] = useState<UpliftPersistedState | null>(() => readUpliftStorage());
  const cachedState =
    queryClient.getQueryData<UpliftPersistedState>(["uplift/state"]) ?? rehydratedState ?? null;
  const [keywordsUploaded, setKeywordsUploaded] = useState(cachedState?.keywordsUploaded ?? false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>(cachedState?.csvData ?? []);
  const [availableColumns, setAvailableColumns] = useState<string[]>(cachedState?.availableColumns ?? []);
  const [results, setResults] = useState<ProjectionResults | null>(cachedState?.results ?? null);
  const [currentParameters, setCurrentParameters] = useState<UpliftParameters | null>(cachedState?.currentParameters ?? null);
  const [searchVolumeRegion, setSearchVolumeRegion] = useState<SearchVolumeRegion>(cachedState?.searchVolumeRegion ?? "UK");
  const hasCalculatedOnce = useRef(false);
  const lastCalculatedParams = useRef<string | null>(null);
  const { toast } = useToast();
  const skipCsvResetOnHydrate = useRef(Boolean(cachedState?.csvData?.length));

  useEffect(() => {
    if (rehydratedState) {
      queryClient.setQueryData<UpliftPersistedState>(["uplift/state"], rehydratedState);
    }
  }, [queryClient, rehydratedState]);

  useEffect(() => {
    if (cachedState) {
      const signature =
        cachedState.lastCalculatedSignature ??
        (cachedState.currentParameters
          ? JSON.stringify({
              params: cachedState.currentParameters,
              region: cachedState.searchVolumeRegion ?? "UK",
            })
          : null);
      if (signature) {
        lastCalculatedParams.current = signature;
      }
      if (cachedState.results) {
        hasCalculatedOnce.current = true;
      }
    }
  }, [cachedState]);

  const { data: status } = useQuery<GoogleStatus>({
    queryKey: ["/api/google/status"],
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const brandTerms = useMemo(() => status?.gsc?.reportSummary?.brandTerms ?? [], [status?.gsc?.reportSummary]);

  const {
    data: gscReport,
    isLoading: isLoadingGSCReport,
    isError: hasGSCReportError,
  } = useQuery<GSCReportResponse>({
    queryKey: ["/api/google/gsc/report", brandTerms.join("|") || "none"],
    enabled: Boolean(status?.gsc?.reportSummary),
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

  const nonBrandCtrData = useMemo(
    () =>
      (gscReport?.nonBrandCtrByPosition ?? []).map((row) => ({
        position: Number(row.position.toFixed(1)),
        ctr: row.ctr,
        clicks: row.clicks,
        impressions: row.impressions,
      })),
    [gscReport?.nonBrandCtrByPosition],
  );

  const percentFormatter = useMemo(() => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }), []);

  const viridisPalette = useMemo(
    () => ["#440154", "#482878", "#3E4989", "#31688E", "#26828E", "#1F9E89", "#35B779", "#6DCD59", "#B4DE2C", "#FDE725", "#F68F6A", "#9AE5D0"],
    [],
  );

  const ctrOverrides = useMemo(() => {
    if (!gscReport?.nonBrandCtrByPosition || gscReport.nonBrandCtrByPosition.length === 0) {
      return null;
    }
    const values = [...DEFAULT_CTR_VALUES];
    gscReport.nonBrandCtrByPosition.forEach((row) => {
      const index = Math.round(row.position) - 1;
      if (index >= 0 && index < values.length && Number.isFinite(row.ctr) && row.ctr > 0) {
        values[index] = row.ctr;
      }
    });
    return values;
  }, [gscReport?.nonBrandCtrByPosition]);

  const sortedCategoryKeys = useMemo(() => {
    if (!results?.categoryUpliftByMonth || results.categoryUpliftByMonth.length === 0) {
      return [] as string[];
    }
    const totals = new Map<string, number>();
    results.categoryUpliftByMonth.forEach(({ category, uplift }) => {
      totals.set(category, (totals.get(category) ?? 0) + uplift);
    });
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category);
  }, [results?.categoryUpliftByMonth]);

  const parseCSV = async (file: File) => {
    return new Promise<void>((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
        complete: (results) => {
          if (results.errors.length > 0) {
            console.error("CSV parsing errors:", results.errors);
            toast({
              title: "CSV parsing warnings",
              description: `Found ${results.errors.length} parsing issues. Some data may be affected.`,
              variant: "destructive",
            });
          }

          if (!results.meta.fields || results.meta.fields.length === 0) {
            reject(new Error("No columns found in CSV"));
            return;
          }

          if (!results.data || results.data.length === 0) {
            reject(new Error("No data rows found in CSV"));
            return;
          }

          setAvailableColumns(results.meta.fields);
          setCsvData(results.data);
          setKeywordsUploaded(true);

          toast({
            title: "File uploaded successfully",
            description: `Parsed ${results.data.length} keywords with ${results.meta.fields.length} columns`,
          });

          resolve();
        },
        error: (error) => {
          toast({
            title: "Error parsing CSV",
            description: error.message,
            variant: "destructive",
          });
          reject(error);
        },
      });
    });
  };

  type CalculationPayload = {
    parameters: UpliftParameters;
    searchVolumeRegion: SearchVolumeRegion;
  };

  const calculateMutation = useMutation<ProjectionResults, Error, CalculationPayload>({
    mutationFn: async ({ parameters, searchVolumeRegion }: CalculationPayload) => {
      const response = await apiRequest("POST", "/api/uplift/calculate", {
        csvData,
        parameters,
        searchVolumeRegion,
      });
      return (await response.json()) as ProjectionResults;
    },
    onSuccess: (data: ProjectionResults) => {
      setResults(data);
      toast({
        title: "Calculation complete",
        description: `Projected ${data.totalUpliftSum.toFixed(0)} additional visits over ${data.monthlyAggregates.length} months`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Calculation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reset calculation flag when new CSV is uploaded
  useEffect(() => {
    if (skipCsvResetOnHydrate.current) {
      skipCsvResetOnHydrate.current = false;
      return;
    }
    if (csvData.length > 0) {
      hasCalculatedOnce.current = false;
      lastCalculatedParams.current = null;
    }
  }, [csvData]);

  // Auto-calculate when parameters change (initial or recalculation)
  useEffect(() => {
    if (!csvData.length || !currentParameters || calculateMutation.isPending) {
      return;
    }

    const paramsSignature = JSON.stringify({
      params: currentParameters,
      region: searchVolumeRegion,
    });

    // Only calculate if parameters or region have changed
    if (lastCalculatedParams.current !== paramsSignature) {
      lastCalculatedParams.current = paramsSignature;
      hasCalculatedOnce.current = true;
      calculateMutation.mutate({ parameters: currentParameters, searchVolumeRegion });
    }
  }, [csvData, currentParameters, searchVolumeRegion, calculateMutation, calculateMutation.isPending]);

  // Memoize callback to prevent infinite loops
  const handleParametersChange = useCallback((params: UpliftParameters) => {
    setCurrentParameters(prevParams => {
      // Only update if parameters actually changed (deep comparison of key values)
      if (JSON.stringify(prevParams) === JSON.stringify(params)) {
        return prevParams;
      }
      return params;
    });
  }, []);

  useEffect(() => {
    const snapshot: UpliftPersistedState = {
      keywordsUploaded,
      availableColumns,
      csvData,
      results,
      currentParameters,
      searchVolumeRegion,
      lastCalculatedSignature: lastCalculatedParams.current,
    };
    queryClient.setQueryData<UpliftPersistedState>(["uplift/state"], snapshot);
    writeUpliftStorage(() => snapshot);
  }, [
    queryClient,
    keywordsUploaded,
    availableColumns,
    csvData,
    results,
    currentParameters,
    searchVolumeRegion,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Uplift Calculator</h1>
        <p className="text-muted-foreground mt-1">
          Upload target keywords and configure parameters to calculate ranking uplift potential
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Keyword Upload</CardTitle>
              <CardDescription>
                Upload your target keyword research file (CSV format)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUploadZone
                onFileSelect={(file) => {
                  setUploadedFile(file);
                  parseCSV(file);
                }}
                formats={["CSV"]}
              />
              {keywordsUploaded && uploadedFile && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle className="h-4 w-4" />
                    File uploaded: {uploadedFile.name}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {csvData.length} keywords, {availableColumns.length} columns
                  </p>
                </div>
              )}
              <div className="mt-6">
                <h3 className="text-sm font-medium text-foreground">Search Volume Region</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose which market to use for Google Ads search volume lookups.
                </p>
                <RadioGroup
                  className="mt-3 grid gap-2 sm:grid-cols-2"
                  value={searchVolumeRegion}
                  onValueChange={(value) => setSearchVolumeRegion(value as SearchVolumeRegion)}
                  data-testid="search-volume-region"
                >
                  <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
                    <RadioGroupItem value="UK" id="search-volume-uk" />
                    <Label htmlFor="search-volume-uk" className="text-sm font-medium leading-none">
                      United Kingdom
                    </Label>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
                    <RadioGroupItem value="US" id="search-volume-us" />
                    <Label htmlFor="search-volume-us" className="text-sm font-medium leading-none">
                      United States
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

            <Card>
              <CardHeader>
                <CardTitle>CTR Curve</CardTitle>
                <CardDescription>
                  CTR data from Search Console analysis
                </CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                {isLoadingGSCReport ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading CTR benchmarks...
                  </div>
                ) : hasGSCReportError || nonBrandCtrData.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                    <span className="material-symbols-outlined text-3xl text-muted-foreground opacity-80" aria-hidden="true">
                      running_with_errors
                    </span>
                    <p className="text-sm text-center px-4">
                      Complete the Search Console phase to import non-brand CTR benchmarks.
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={nonBrandCtrData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="position"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(value) => `${value}`}
                        allowDecimals={false}
                      />
                      <YAxis tickFormatter={(value) => `${percentFormatter.format(value * 100)}%`} />
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
                            <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-sm">
                              <div className="font-semibold">Position #{label}</div>
                              <div className="text-muted-foreground">
                                CTR: {percentFormatter.format(point.ctr * 100)}%
                              </div>
                              <div className="text-muted-foreground">
                                Clicks: {point.clicks.toLocaleString()}
                              </div>
                              <div className="text-muted-foreground">
                                Impressions: {point.impressions.toLocaleString()}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="ctr"
                        stroke="#2563EB"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="CTR"
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

          {availableColumns.length > 0 && (
            <ParameterPanel
              availableColumns={availableColumns}
              onParametersChange={handleParametersChange}
              ctrOverrides={ctrOverrides ?? undefined}
            />
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          {calculateMutation.isPending && (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loader-calculating" />
                  <p className="text-lg font-medium">Calculating...</p>
                  <p className="text-sm text-muted-foreground">
                    Processing {csvData.length} keywords with uplift projections
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {results && !calculateMutation.isPending ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Projection Summary
                  </CardTitle>
                  <CardDescription>
                    Traffic uplift projections over {results.monthlyAggregates.length} months
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Total Additional Traffic</p>
                      <p className="text-2xl font-bold text-primary">
                        {results.totalUpliftSum >= 1000 
                          ? `${(results.totalUpliftSum / 1000).toFixed(1)}K` 
                          : results.totalUpliftSum.toFixed(0)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Traffic Uplift</p>
                      <p className="text-2xl font-bold text-success">
                        {results.upliftPercentage.toFixed(1)}%
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Baseline Traffic</p>
                      <p className="text-2xl font-bold">
                        {results.totalBaselineSum >= 1000 
                          ? `${(results.totalBaselineSum / 1000).toFixed(1)}K` 
                          : results.totalBaselineSum.toFixed(0)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Projections</CardTitle>
                  <CardDescription>
                    Traffic forecasts by month
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-4 text-sm font-medium pb-2 border-b">
                      <div>Month</div>
                      <div className="text-right">Baseline</div>
                      <div className="text-right">Projected</div>
                      <div className="text-right text-primary">Uplift</div>
                    </div>
                    {results.monthlyAggregates.map((month) => {
                      const monthDate = new Date(month.monthStart);
                      const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                      return (
                        <div key={month.monthStart} className="grid grid-cols-4 gap-4 text-sm py-2">
                          <div className="font-medium">{monthLabel}</div>
                          <div className="text-right text-muted-foreground">{month.totalBaseline.toFixed(0)}</div>
                          <div className="text-right">{month.totalVisits.toFixed(0)}</div>
                          <div className="text-right text-primary font-medium">
                            +{month.totalUplift.toFixed(0)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Total Uplift by Month</CardTitle>
                  <CardDescription>
                    Baseline and uplift traffic over projection horizon
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={results.monthlyAggregates.map(month => ({
                        month: new Date(month.monthStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                        Baseline: Math.round(month.totalBaseline),
                        Uplift: Math.round(month.totalUplift),
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Legend />
                        <Bar dataKey="Baseline" stackId="a" fill="#2b0573" opacity={0.85} name="Baseline" />
                        <Bar dataKey="Uplift" stackId="a" fill="#AAA0FF" name="Uplift" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Uplift by Category</CardTitle>
                  <CardDescription>
                    Traffic uplift breakdown by category over time
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={(() => {
                        const monthlyData = new Map<string, any>();
                        results.categoryUpliftByMonth.forEach(item => {
                          const monthKey = new Date(item.monthStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                          if (!monthlyData.has(monthKey)) {
                            monthlyData.set(monthKey, { month: monthKey });
                          }
                          monthlyData.get(monthKey)![item.category] = Math.round(item.uplift);
                        });
                        return Array.from(monthlyData.values());
                      })()}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Legend />
                      {(sortedCategoryKeys.length > 0
                        ? sortedCategoryKeys
                        : Array.from(new Set(results.categoryUpliftByMonth.map(item => item.category)))
                      ).map((category, i) => (
                        <Bar
                          key={category}
                          dataKey={category}
                          stackId="a"
                          fill={viridisPalette[i % viridisPalette.length]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Uplift by Intent</CardTitle>
                  <CardDescription>
                    Traffic uplift breakdown by search intent over time
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={(() => {
                        const monthlyData = new Map<string, any>();
                        results.intentUpliftByMonth.forEach(item => {
                          const monthKey = new Date(item.monthStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                          if (!monthlyData.has(monthKey)) {
                            monthlyData.set(monthKey, { month: monthKey });
                          }
                          monthlyData.get(monthKey)![item.intent] = Math.round(item.uplift);
                        });
                        return Array.from(monthlyData.values());
                      })()}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Legend />
                      {Array.from(new Set(results.intentUpliftByMonth.map(item => item.intent))).map((intent, i) => {
                        const colors = [
                          'hsl(200, 70%, 50%)',
                          'hsl(340, 70%, 50%)',
                          'hsl(30, 70%, 50%)',
                        ];
                        return (
                          <Bar key={intent} dataKey={intent} stackId="a" fill={colors[i % colors.length]} />
                        );
                      })}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {results && !calculateMutation.isPending && (
                <div className="flex justify-end pt-6">
                  <Button
                    size="lg"
                    onClick={() => navigate("/prophet")}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 animate-cta-pulse gap-2 border-0"
                  >
                    <span className="material-symbols-outlined text-xl" aria-hidden="true">
                      arrow_circle_right
                    </span>
                    Proceed to Next Phase
                  </Button>
                </div>
              )}
              <hr></hr>
              <Card>
                <CardHeader>
                  <CardTitle>Download Results</CardTitle>
                  <CardDescription>
                    Export detailed projections for further analysis
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <button
                    onClick={() => {
                      const csv = [
                        ["Keyword", "Volume", "Difficulty", "Start Rank", "Month", "Predicted Rank", "Expected CTR", "Expected Visits", "Baseline Visits", "Uplift"],
                        ...results.detailedProjections.map(p => [
                          p.keyword,
                          p.volume,
                          p.difficulty,
                          p.startRank,
                          p.monthStart,
                          p.predRank,
                          p.expCtr,
                          p.expVisits,
                          p.baselineVisits,
                          p.expUplift,
                        ])
                      ].map(row => row.join(',')).join('\n');
                      
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'rank_traffic_projection.csv';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                    data-testid="button-download-csv"
                  >
                    Download Detailed Projections (CSV)
                  </button>
                </CardContent>
              </Card>

              {results.seasonalVolumeDebug && results.seasonalVolumeDebug.length > 0 && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-muted-foreground text-base" aria-hidden="true">troubleshoot</span>
                      <CardTitle>Seasonal Volume Debug Data</CardTitle>
                    </div>
                    <CardDescription>
                      Google Ads API seasonal volume data retrieved for each keyword (12-month pattern)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-[28rem] overflow-auto pr-2">
                      <Table className="min-w-[1100px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[250px]">Keyword</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Jan</TableHead>
                            <TableHead>Feb</TableHead>
                            <TableHead>Mar</TableHead>
                            <TableHead>Apr</TableHead>
                            <TableHead>May</TableHead>
                            <TableHead>Jun</TableHead>
                            <TableHead>Jul</TableHead>
                            <TableHead>Aug</TableHead>
                            <TableHead>Sep</TableHead>
                            <TableHead>Oct</TableHead>
                            <TableHead>Nov</TableHead>
                            <TableHead>Dec</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.seasonalVolumeDebug.map((debug, idx) => (
                            <TableRow key={idx} data-testid={`debug-row-${idx}`}>
                              <TableCell className="font-medium">{debug.keyword}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={debug.source === "cache" ? "default" : "secondary"}
                                  data-testid={`source-badge-${idx}`}
                                >
                                  {debug.source === "cache" ? "Google Ads" : "Fallback"}
                                </Badge>
                              </TableCell>
                              {debug.monthlyVolumes.map((volume, monthIdx) => (
                                <TableCell
                                  key={monthIdx}
                                  className="text-right"
                                  data-testid={`volume-${idx}-${monthIdx}`}
                                >
                                  {volume.toLocaleString()}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-sm text-muted-foreground mt-4">
                      <strong>Source:</strong> "Google Ads" indicates data was matched to a Google Ads result. 
                      "Fallback" means the calculator used the uploaded average volume instead.
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          ) : !calculateMutation.isPending && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  Upload keywords and configure parameters to see uplift forecast and calculations
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

    </div>
  );
}
