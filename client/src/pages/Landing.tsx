import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";
import {
  AreaChart,
  SearchInsights,
  Cadence,
  Preview,
} from "@nine-thirty-five/material-symbols-react/outlined";

export default function Landing() {
  const handleGetStarted = useCallback(async () => {
    try {
      await fetch("/api/report/session-start", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.warn("Failed to record report session start", error);
    } finally {
      window.location.href = "/ga";
    }
  }, []);

  const features = [
    {
      icon: AreaChart,
      title: "Google Analytics Integration",
      description: "Connect your GA4 account to analyze historic organic traffic patterns and revenue data"
    },
    {
      icon: SearchInsights,
      title: "Search Console Analysis",
      description: "Automatically separate brand and non-brand queries with CTR curve generation"
    },
    {
      icon: Cadence,
      title: "Uplift Calculator",
      description: "Upload keyword research and calculate ranking improvement opportunities"
    },
    {
      icon: Preview,
      title: "Prophet Projections",
      description: "Advanced traffic predictions with confidence intervals and revenue projections"
    }
  ];

  const steps = [
    "Connect your Google Analytics and Search Console accounts",
    "Define brand regex to separate query types",
    "Upload target keyword research file",
    "Configure uplift parameters and confidence levels",
    "View comprehensive forecasts and export results to CSV or Excel"
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container max-w-6xl mx-auto px-6 py-12">
        <div className="text-center space-y-6 mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img 
              src="/oppengine-animated.gif" 
              alt="OppEngine" 
              className="h-24 w-24 object-contain"
            />
          </div>
          <h1 className="text-5xl font-bold tracking-tight font-display">
            OppEngine
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Advanced digital marketing analysis platform that integrates Google Analytics and Search Console data to forecast traffic and identify keyword ranking opportunities
          </p>
          <div className="flex justify-center pt-4">
            <Button
              size="lg"
              className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 animate-cta-pulse gap-2 text-lg px-8 py-6 border-0 focus-visible:ring-emerald-500"
              onClick={handleGetStarted}
              data-testid="button-get-started"
            >
              Get Started
              <span className="material-symbols-outlined text-xl" aria-hidden="true">
                arrow_circle_right
              </span>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            No account required {"\u2022"} Session-based data {"\u2022"} Privacy-first
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {features.map((feature, i) => (
            <Card key={i} className="hover-elevate">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-2xl">How It Works</CardTitle>
            <CardDescription>
              Complete the 4-step workflow to generate comprehensive opportunity analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-sm flex-shrink-0">
                    {i + 1}
                  </div>
                  <p className="text-foreground pt-1">{step}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="mt-12 text-center">
          <Card className="inline-block border-success/20 bg-success/5">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-success mb-2">
                <CheckCircle className="h-5 w-5" />
                <span className="font-semibold">Free to Use</span>
              </div>
              <p className="text-sm text-muted-foreground">
                No subscription required {"\u2022"} Works with your own Google accounts {"\u2022"} Session-based OAuth tokens
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

