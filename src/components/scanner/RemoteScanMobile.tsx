// Remote Scan (phone → desktop bridge) requires cloud realtime + storage.
// The scanner is local-first, so this feature is disabled. The component
// renders a small notice instead of attempting to open a channel.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WifiOff } from "lucide-react";

interface RemoteScanMobileProps {
  userId: string;
}

export const RemoteScanMobile = (_props: RemoteScanMobileProps) => {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WifiOff className="h-5 w-5" />
          Remote Scan Disabled
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Remote phone-to-desktop scanning requires cloud realtime and is
        turned off in local-first mode. Use the in-app scanner directly.
      </CardContent>
    </Card>
  );
};
