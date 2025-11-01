import { MetricCard } from "../MetricCard";
import { Users, DollarSign, ShoppingCart } from "lucide-react";

export default function MetricCardExample() {
  return (
    <div className="grid gap-4 md:grid-cols-3 p-6">
      <MetricCard
        title="Total Sessions"
        value="145,234"
        trend={{ value: 12.5, direction: "up" }}
        subtitle="vs last month"
        icon={<Users className="h-4 w-4" />}
        sparklineData={[45, 52, 48, 65, 58, 72, 68]}
      />
      <MetricCard
        title="Revenue"
        value="$52,340"
        trend={{ value: 8.2, direction: "up" }}
        subtitle="vs last month"
        icon={<DollarSign className="h-4 w-4" />}
        sparklineData={[32, 45, 38, 52, 48, 61, 58]}
      />
      <MetricCard
        title="Conversion Rate"
        value="3.24%"
        trend={{ value: 2.1, direction: "down" }}
        subtitle="vs last month"
        icon={<ShoppingCart className="h-4 w-4" />}
      />
    </div>
  );
}
