import { useAuth } from "@/hooks/use-auth";
import Scanner from "@/components/Scanner";
import { Loader2 } from "lucide-react";

export default function ScanPage() {
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
        <p className="text-muted-foreground">Please log in to scan cards</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <Scanner userId={userId} />
    </div>
  );
}
