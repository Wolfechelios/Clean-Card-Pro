import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import type { FeatureFlagKey } from "@/lib/featureFlags";

export function FeatureGate({
  flag,
  children,
  fallbackPath = "/dashboard",
}: {
  flag: FeatureFlagKey;
  children: ReactNode;
  fallbackPath?: string;
}) {
  const { flags, loading } = useFeatureFlags();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!flags[flag]) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}
