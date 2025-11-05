import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface OpportunityBarChartProps {
  data: Array<{
    category: string;
    opportunityScore: number;
    estimatedSessions: number;
  }>;
  onCategoryClick?: (category: string) => void;
}

export function OpportunityBarChart({ data, onCategoryClick }: OpportunityBarChartProps) {
  const sortedData = [...data].sort((a, b) => b.opportunityScore - a.opportunityScore);

  const getBarColor = (score: number) => {
    if (score >= 8) return "hsl(var(--chart-1))";
    if (score >= 6) return "hsl(var(--chart-2))";
    if (score >= 4) return "hsl(var(--chart-3))";
    return "hsl(var(--chart-4))";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Category Opportunities</CardTitle>
        <CardDescription>
          Ranked by opportunity score and traffic potential
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={sortedData} layout="horizontal">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              stroke="hsl(var(--muted-foreground))"
              label={{ value: "Opportunity Score", position: "insideBottom", offset: -5 }}
            />
            <YAxis
              type="category"
              dataKey="category"
              stroke="hsl(var(--muted-foreground))"
              width={120}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
              formatter={(value: number, name: string) => {
                if (name === "opportunityScore") return [value, "Score"];
                if (name === "estimatedSessions") return [value.toLocaleString(), "Est. Sessions"];
                return [value, name];
              }}
            />
            <Bar
              dataKey="opportunityScore"
              radius={[0, 4, 4, 0]}
              onClick={(data) => onCategoryClick?.(data.category)}
              cursor="pointer"
            >
              {sortedData.map((entry, index) => (
                <Cell key={index} fill={getBarColor(entry.opportunityScore)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
