import { useAuth } from "@/hooks/use-auth";
import { BinderScan } from "@/components/binder/BinderScan";
import { Loader2 } from "lucide-react";

export default function BindersPage() {
  const { userId, loading } = useAuth();

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
        <p className="text-muted-foreground">Please log in to scan binder pages</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Binder Scanner</h1>
        <p className="text-muted-foreground mt-2">
          Scan binder pages to automatically identify and add cards to your collection
        </p>
      </div>
      <BinderScan binderName="My Collection" onComplete={() => {}} />
    </div>
  );
}
