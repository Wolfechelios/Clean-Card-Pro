import { useAuth } from "@/hooks/use-auth";
import Scanner from "@/components/Scanner";
import { RemoteScanMobile } from "@/components/scanner/RemoteScanMobile";
import { Loader2, Bug } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function ScanPage() {
  const { userId, loading } = useAuth();
  const remoteCode = new URLSearchParams(window.location.search).get("remote");

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Please log in to scan cards</p>
      </div>
    );
  }

  if (remoteCode) {
    return (
      <div className="container mx-auto max-w-lg p-4">
        <RemoteScanMobile userId={userId} initialSessionCode={remoteCode} />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 p-6">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold">iPhone camera acting up?</div>
            <p className="text-xs text-muted-foreground">
              Open Camera Debug, run the 720p test, then copy the saved log.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/camera-debug">
              <Bug className="mr-2 h-4 w-4" />
              Camera Debug
            </Link>
          </Button>
        </div>
      </div>
      <Scanner userId={userId} />
    </div>
  );
}
