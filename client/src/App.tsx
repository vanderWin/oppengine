import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppFooter } from "@/components/AppFooter";
import { Home, BarChart2, TrendingUp, FileText } from "lucide-react";
import Landing from "@/pages/Landing";
import GoogleAnalytics from "@/pages/GoogleAnalytics";
import SearchConsole from "@/pages/SearchConsole";
import UpliftCalculator from "@/pages/UpliftCalculator";
import ResultsDashboard from "@/pages/ResultsDashboard";

function Router() {
  const [location] = useLocation();

  const steps = [
    { id: "ga", title: "Google Analytics", icon: Home, path: "/ga", completed: false },
    { id: "gsc", title: "Search Console", icon: BarChart2, path: "/gsc", completed: false },
    { id: "uplift", title: "Uplift Calculator", icon: TrendingUp, path: "/uplift", completed: false },
    { id: "results", title: "Results Dashboard", icon: FileText, path: "/results", completed: false },
  ];

  const sidebarStyle = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  };

  // Show landing page on root path, otherwise show app
  if (location === "/") {
    return (
      <div className="flex flex-col min-h-screen">
        <main className="flex-1">
          <Landing />
        </main>
        <AppFooter />
      </div>
    );
  }

  // Show app with sidebar for all other routes
  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar currentPath={location} steps={steps} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between px-6 py-4 border-b bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto">
            <div className="container max-w-7xl mx-auto px-6 py-8">
              <Switch>
                <Route path="/ga" component={GoogleAnalytics} />
                <Route path="/gsc" component={SearchConsole} />
                <Route path="/uplift" component={UpliftCalculator} />
                <Route path="/results" component={ResultsDashboard} />
                <Route>
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <h1 className="text-4xl font-bold mb-4">404</h1>
                      <p className="text-muted-foreground">Page not found</p>
                    </div>
                  </div>
                </Route>
              </Switch>
            </div>
          </main>
          <AppFooter />
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
