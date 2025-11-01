import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface CTRCurveChartProps {
  data: Array<{
    position: number;
    brandCTR: number;
    nonBrandCTR: number;
    combinedCTR: number;
  }>;
}

export function CTRCurveChart({ data }: CTRCurveChartProps) {
  const [showBrand, setShowBrand] = useState(true);
  const [showNonBrand, setShowNonBrand] = useState(true);
  const [showCombined, setShowCombined] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>CTR Curve Analysis</CardTitle>
            <CardDescription>
              Click-through rate by position (1-20)
            </CardDescription>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="show-brand"
                checked={showBrand}
                onCheckedChange={setShowBrand}
                data-testid="toggle-brand"
              />
              <Label htmlFor="show-brand" className="text-sm">Brand</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="show-non-brand"
                checked={showNonBrand}
                onCheckedChange={setShowNonBrand}
                data-testid="toggle-non-brand"
              />
              <Label htmlFor="show-non-brand" className="text-sm">Non-Brand</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="show-combined"
                checked={showCombined}
                onCheckedChange={setShowCombined}
                data-testid="toggle-combined"
              />
              <Label htmlFor="show-combined" className="text-sm">Combined</Label>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="position"
              stroke="hsl(var(--muted-foreground))"
              label={{ value: "Position", position: "insideBottom", offset: -5 }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              label={{ value: "CTR %", angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
            />
            <Legend />
            {showBrand && (
              <Line
                type="monotone"
                dataKey="brandCTR"
                stroke="hsl(var(--chart-1))"
                strokeWidth={2}
                name="Brand CTR"
                dot={false}
              />
            )}
            {showNonBrand && (
              <Line
                type="monotone"
                dataKey="nonBrandCTR"
                stroke="hsl(var(--chart-2))"
                strokeWidth={2}
                name="Non-Brand CTR"
                dot={false}
              />
            )}
            {showCombined && (
              <Line
                type="monotone"
                dataKey="combinedCTR"
                stroke="hsl(var(--chart-3))"
                strokeWidth={2}
                name="Combined CTR"
                dot={false}
                strokeDasharray="5 5"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
