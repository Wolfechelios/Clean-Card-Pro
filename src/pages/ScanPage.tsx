import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Scanner from "@/components/Scanner";
import { Loader2 } from "lucide-react";

export default function ScanPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);
      setLoading(false);
    };
    getUser();
  }, []);

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
