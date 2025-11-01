import { MetricCard } from "@/components/MetricCard";
import { UpliftForecastChart } from "@/components/UpliftForecastChart";
import { OpportunityBarChart } from "@/components/OpportunityBarChart";
import { DataTable } from "@/components/DataTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, TrendingUp, Target, Zap } from "lucide-react";

export default function ResultsDashboard() {
  //todo: remove mock functionality
  const mockForecastData = [
    { date: "Jan", historic: 45000, predictedBrand: 0, predictedNonBrand: 0, uplift: 0 },
    { date: "Feb", historic: 47000, predictedBrand: 0, predictedNonBrand: 0, uplift: 0 },
    { date: "Mar", historic: 49000, predictedBrand: 0, predictedNonBrand: 0, uplift: 0 },
    { date: "Apr", historic: 51000, predictedBrand: 0, predictedNonBrand: 0, uplift: 0 },
    { date: "May", predictedBrand: 28000, predictedNonBrand: 32000, uplift: 8000 },
    { date: "Jun", predictedBrand: 29500, predictedNonBrand: 33800, uplift: 8500 },
    { date: "Jul", predictedBrand: 31000, predictedNonBrand: 35600, uplift: 9000 },
    { date: "Aug", predictedBrand: 32500, predictedNonBrand: 37400, uplift: 9500 },
    { date: "Sep", predictedBrand: 34000, predictedNonBrand: 39200, uplift: 10000 },
  ];

  const mockCategoryData = [
    { category: "SEO Marketing", opportunityScore: 92, estimatedSessions: 12500 },
    { category: "Content Strategy", opportunityScore: 85, estimatedSessions: 9800 },
    { category: "Analytics Tools", opportunityScore: 78, estimatedSessions: 7200 },
    { category: "Digital Advertising", opportunityScore: 65, estimatedSessions: 5400 },
    { category: "Social Media", opportunityScore: 52, estimatedSessions: 3900 },
  ];

  const mockKeywordData = [
    { keyword: "seo marketing strategy", currentPosition: 12, targetPosition: 5, volume: 8900, ctrGain: 4.2, estimatedSessions: 374, revenueImpact: 1496 },
    { keyword: "content marketing tips", currentPosition: 8, targetPosition: 3, volume: 5600, ctrGain: 6.8, estimatedSessions: 381, revenueImpact: 1524 },
    { keyword: "digital analytics tools", currentPosition: 15, targetPosition: 7, volume: 4200, ctrGain: 3.5, estimatedSessions: 147, revenueImpact: 588 },
    { keyword: "social media management", currentPosition: 10, targetPosition: 4, volume: 7800, ctrGain: 5.1, estimatedSessions: 398, revenueImpact: 1592 },
  ];

  const keywordColumns = [
    { key: "keyword", header: "Keyword", sortable: true },
    { 
      key: "currentPosition", 
      header: "Current Pos.", 
      sortable: true,
      render: (val: number) => <Badge variant="secondary">{val}</Badge>
    },
    { 
      key: "targetPosition", 
      header: "Target Pos.", 
      sortable: true,
      render: (val: number) => <Badge variant="default">{val}</Badge>
    },
    { 
      key: "volume", 
      header: "Volume", 
      sortable: true,
      render: (val: number) => val.toLocaleString()
    },
    { 
      key: "ctrGain", 
      header: "CTR Gain %", 
      sortable: true,
      render: (val: number) => `+${val.toFixed(1)}%`
    },
    { 
      key: "estimatedSessions", 
      header: "Est. Sessions", 
      sortable: true,
      render: (val: number) => val.toLocaleString()
    },
    { 
      key: "revenueImpact", 
      header: "Revenue Impact", 
      sortable: true,
      render: (val: number) => `$${val.toLocaleString()}`
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Results Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Comprehensive analysis of opportunity potential and traffic projections
          </p>
        </div>
        <Button className="gap-2" data-testid="button-export-all">
          <Download className="h-4 w-4" />
          Export All Results
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Historic Sessions"
          value="192,000"
          subtitle="Last 12 months"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          title="Predicted Sessions"
          value="256,400"
          trend={{ value: 33.5, direction: "up" }}
          subtitle="Next 12 months"
          icon={<Target className="h-4 w-4" />}
        />
        <MetricCard
          title="Uplift Opportunity"
          value="+64,400"
          subtitle="From ranking improvements"
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      <UpliftForecastChart
        data={mockForecastData}
        onExport={() => console.log("Export forecast")}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <OpportunityBarChart
          data={mockCategoryData}
          onCategoryClick={(cat) => console.log("Category:", cat)}
        />

        <Card>
          <CardHeader>
            <CardTitle>Category Summary</CardTitle>
            <CardDescription>
              Top opportunities by category with key metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockCategoryData.slice(0, 5).map((cat) => (
                <div key={cat.category} className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">{cat.category}</p>
                    <p className="text-sm text-muted-foreground">
                      Est. {cat.estimatedSessions.toLocaleString()} sessions
                    </p>
                  </div>
                  <Badge
                    variant={cat.opportunityScore >= 80 ? "default" : "secondary"}
                    className="tabular-nums"
                  >
                    Score: {cat.opportunityScore}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Keyword-Level Analysis</CardTitle>
              <CardDescription>
                Detailed uplift potential for each target keyword
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-2" data-testid="button-export-keywords">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={mockKeywordData}
            columns={keywordColumns}
          />
        </CardContent>
      </Card>
    </div>
  );
}
