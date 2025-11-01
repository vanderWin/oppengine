import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  trend?: {
    value: number;
    direction: "up" | "down" | "neutral";
  };
  subtitle?: string;
  icon?: React.ReactNode;
  sparklineData?: number[];
}

export function MetricCard({
  title,
  value,
  trend,
  subtitle,
  icon,
  sparklineData,
}: MetricCardProps) {
  const TrendIcon = trend
    ? trend.direction === "up"
      ? TrendingUp
      : trend.direction === "down"
      ? TrendingDown
      : Minus
    : null;

  return (
    <Card className="hover-elevate" data-testid={`metric-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          <div className="text-3xl font-bold tabular-nums">{value}</div>
          {(trend || subtitle) && (
            <div className="flex items-center gap-2 text-sm">
              {trend && TrendIcon && (
                <span
                  className={cn(
                    "flex items-center gap-1 font-medium",
                    trend.direction === "up" && "text-success",
                    trend.direction === "down" && "text-destructive",
                    trend.direction === "neutral" && "text-muted-foreground"
                  )}
                >
                  <TrendIcon className="h-3 w-3" />
                  {Math.abs(trend.value)}%
                </span>
              )}
              {subtitle && (
                <span className="text-muted-foreground">{subtitle}</span>
              )}
            </div>
          )}
          {sparklineData && sparklineData.length > 0 && (
            <div className="h-8 flex items-end gap-0.5">
              {sparklineData.map((val, i) => {
                const max = Math.max(...sparklineData);
                const height = (val / max) * 100;
                return (
                  <div
                    key={i}
                    className="flex-1 bg-primary rounded-sm opacity-60"
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
