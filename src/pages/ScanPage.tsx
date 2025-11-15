import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Scanner from "@/components/Scanner";

export default function ScanPage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
      }
    };
    getUser();
  }, []);

  if (!userId) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Scan Cards</h1>
      <Scanner userId={userId} />
    </div>
  );
}
