import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import Papa from "papaparse";
import { FileUploadZone } from "@/components/FileUploadZone";
import { ParameterPanel } from "@/components/ParameterPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, FileText, TrendingUp, Loader2, Bug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { UpliftParameters, ProjectionResults } from "@shared/schema";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";

export default function UpliftCalculator() {
  const [, navigate] = useLocation();
  const [keywordsUploaded, setKeywordsUploaded] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [results, setResults] = useState<ProjectionResults | null>(null);
  const [currentParameters, setCurrentParameters] = useState<UpliftParameters | null>(null);
  const hasCalculatedOnce = useRef(false);
  const lastCalculatedParams = useRef<string | null>(null);
  const { toast } = useToast();

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

  const calculateMutation = useMutation({
    mutationFn: async (parameters: UpliftParameters) => {
      const response = await apiRequest("POST", "/api/uplift/calculate", { csvData, parameters });
      return response.json() as Promise<ProjectionResults>;
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

    const paramsString = JSON.stringify(currentParameters);
    
    // Only calculate if parameters have actually changed
    if (lastCalculatedParams.current !== paramsString) {
      lastCalculatedParams.current = paramsString;
      hasCalculatedOnce.current = true;
      calculateMutation.mutate(currentParameters);
    }
  }, [csvData, currentParameters, calculateMutation, calculateMutation.isPending]);

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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>CTR Curve</CardTitle>
              <CardDescription>
                CTR data from Search Console analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-6 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Complete Search Console step to import CTR curve</p>
              </div>
            </CardContent>
          </Card>

          {availableColumns.length > 0 && (
            <ParameterPanel
              availableColumns={availableColumns}
              onParametersChange={handleParametersChange}
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
                      <Bar dataKey="Baseline" stackId="a" fill="hsl(var(--primary))" opacity={0.5} />
                      <Bar dataKey="Uplift" stackId="a" fill="hsl(var(--primary))" />
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
                      {Array.from(new Set(results.categoryUpliftByMonth.map(item => item.category))).map((category, i) => {
                        const colors = [
                          'hsl(262, 83%, 58%)',
                          'hsl(262, 83%, 48%)',
                          'hsl(262, 83%, 38%)',
                          'hsl(262, 83%, 68%)',
                          'hsl(220, 70%, 50%)',
                          'hsl(30, 70%, 50%)',
                          'hsl(150, 70%, 50%)',
                          'hsl(340, 70%, 50%)',
                        ];
                        return (
                          <Bar key={category} dataKey={category} stackId="a" fill={colors[i % colors.length]} />
                        );
                      })}
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
                      <Bug className="h-5 w-5 text-muted-foreground" />
                      <CardTitle>Seasonal Volume Debug Data</CardTitle>
                    </div>
                    <CardDescription>
                      Google Ads API seasonal volume data retrieved for each keyword (12-month pattern)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
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
                                <TableCell key={monthIdx} className="text-right" data-testid={`volume-${idx}-${monthIdx}`}>
                                  {volume.toLocaleString()}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-sm text-muted-foreground mt-4">
                      <strong>Source:</strong> "Google Ads" indicates data was retrieved from the cache (mock data until API configured). 
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

      {results && !calculateMutation.isPending && (
        <div className="flex justify-end pt-8">
          <Button
            size="lg"
            onClick={() => navigate("/results")}
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
