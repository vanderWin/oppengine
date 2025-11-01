import { AppSidebar } from "../AppSidebar";
import { Home, BarChart2, TrendingUp, FileText } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function AppSidebarExample() {
  const steps = [
    { id: "ga", title: "Google Analytics", icon: Home, path: "/", completed: true },
    { id: "gsc", title: "Search Console", icon: BarChart2, path: "/gsc", completed: false },
    { id: "uplift", title: "Uplift Calculator", icon: TrendingUp, path: "/uplift", completed: false },
    { id: "results", title: "Results Dashboard", icon: FileText, path: "/results", completed: false },
  ];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar currentPath="/" steps={steps} />
      </div>
    </SidebarProvider>
  );
}
