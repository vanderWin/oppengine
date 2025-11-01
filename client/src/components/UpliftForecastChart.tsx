import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface UpliftForecastChartProps {
  data: Array<{
    date: string;
    historic?: number;
    predictedBrand: number;
    predictedNonBrand: number;
    uplift: number;
  }>;
  onExport?: () => void;
}

export function UpliftForecastChart({ data, onExport }: UpliftForecastChartProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Traffic Forecast & Uplift</CardTitle>
            <CardDescription>
              Historic sessions vs. predicted traffic with uplift potential
            </CardDescription>
          </div>
          {onExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              className="gap-2"
              data-testid="button-export-chart"
            >
              <Download className="h-4 w-4" />
              Export Chart
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="historicGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="brandGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="nonBrandGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="upliftGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-4))" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(var(--chart-4))" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              label={{ value: "Sessions", angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="historic"
              stroke="hsl(var(--chart-1))"
              fill="url(#historicGradient)"
              name="Historic"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="predictedBrand"
              stroke="hsl(var(--chart-2))"
              fill="url(#brandGradient)"
              name="Predicted Brand"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="predictedNonBrand"
              stroke="hsl(var(--chart-3))"
              fill="url(#nonBrandGradient)"
              name="Predicted Non-Brand"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="uplift"
              stroke="hsl(var(--chart-4))"
              fill="url(#upliftGradient)"
              name="Uplift Opportunity"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
