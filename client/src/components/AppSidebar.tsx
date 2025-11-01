import { Home, BarChart2, TrendingUp, FileText, CheckCircle } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  title: string;
  icon: React.ElementType;
  path: string;
  completed: boolean;
}

interface AppSidebarProps {
  currentPath: string;
  steps: Step[];
}

export function AppSidebar({ currentPath, steps }: AppSidebarProps) {
  return (
    <Sidebar>
      <SidebarHeader className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img 
            src="/engineering2.png" 
            alt="OppEngine" 
            className="h-10 w-10 object-contain"
          />
          <div>
            <h2 className="text-base font-semibold text-sidebar-foreground font-display">OppEngine</h2>
            <p className="text-xs text-muted-foreground">Opportunity Analysis</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Analysis Workflow</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {steps.map((step) => {
                const Icon = step.icon;
                const isActive = currentPath === step.path;
                return (
                  <SidebarMenuItem key={step.id}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive}
                      className={cn(
                        "gap-3",
                        isActive && "bg-sidebar-accent"
                      )}
                      data-testid={`nav-${step.id}`}
                    >
                      <a href={step.path}>
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{step.title}</span>
                        {step.completed && (
                          <CheckCircle className="h-4 w-4 text-success" data-testid={`status-${step.id}-completed`} />
                        )}
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
