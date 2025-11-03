import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface OAuthConnectionCardProps {
  service: string;
  logo?: React.ReactNode;
  description: string;
  isConnected: boolean;
  connectedEmail?: string;
  onConnect: () => void;
  onDisconnect?: () => void;
  onRefresh?: () => void;
}

export function OAuthConnectionCard({
  service,
  logo,
  description,
  isConnected,
  connectedEmail,
  onConnect,
  onDisconnect,
  onRefresh,
}: OAuthConnectionCardProps) {
  return (
    <Card className="hover-elevate">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {logo && (
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                {logo}
              </div>
            )}
            <div>
              <CardTitle>{service}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Badge
            variant={isConnected ? "default" : "secondary"}
            className={cn(
              "gap-1",
              isConnected && "bg-success text-success-foreground"
            )}
            data-testid={`status-${service.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {isConnected ? (
              <>
                <CheckCircle className="h-3 w-3" />
                Connected
              </>
            ) : (
              <>
                <XCircle className="h-3 w-3" />
                Not Connected
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected && connectedEmail && (
          <div className="rounded-md bg-muted p-3">
            <p className="text-sm text-muted-foreground">Connected Account</p>
            <p className="font-medium font-mono text-sm" data-testid="connected-email">{connectedEmail}</p>
          </div>
        )}
        <div className="flex gap-2">
          {!isConnected ? (
            <Button
              onClick={onConnect}
              className="w-full"
              data-testid={`button-connect-${service.toLowerCase().replace(/\s+/g, "-")}`}
            >
              Connect {service}
            </Button>
          ) : (
            <>
              {onRefresh && (
                <Button
                  variant="outline"
                  onClick={onRefresh}
                  className="gap-2"
                  data-testid="button-refresh"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              )}
              {onDisconnect && (
                <Button
                  variant="outline"
                  onClick={onDisconnect}
                  className="flex-1"
                  data-testid="button-disconnect"
                >
                  Disconnect
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
