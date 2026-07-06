// Remote Scan desktop side — disabled in local-first mode.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WifiOff } from "lucide-react";

interface RemoteScanDesktopProps {
  userId: string;
  onImageReceived: (imageFile: File) => void;
}

export const RemoteScanDesktop = (_props: RemoteScanDesktopProps) => {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WifiOff className="h-5 w-5" />
          Remote Scan Disabled
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The phone-to-desktop bridge requires cloud realtime, which is off
        in local-first mode. Capture directly with the desktop scanner.
      </CardContent>
    </Card>
  );
};
