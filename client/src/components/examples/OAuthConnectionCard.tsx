import { OAuthConnectionCard } from "../OAuthConnectionCard";
import { BarChart } from "lucide-react";

export default function OAuthConnectionCardExample() {
  return (
    <div className="grid gap-6 max-w-2xl p-6">
      <OAuthConnectionCard
        service="Google Analytics"
        logo={<BarChart className="h-6 w-6 text-primary" />}
        description="Connect to fetch organic traffic data"
        isConnected={false}
        onConnect={() => console.log("Connect GA")}
      />
      <OAuthConnectionCard
        service="Google Search Console"
        logo={<BarChart className="h-6 w-6 text-primary" />}
        description="Connect to analyze search performance"
        isConnected={true}
        connectedEmail="user@example.com"
        onConnect={() => console.log("Connect GSC")}
        onDisconnect={() => console.log("Disconnect GSC")}
        onRefresh={() => console.log("Refresh GSC")}
      />
    </div>
  );
}
