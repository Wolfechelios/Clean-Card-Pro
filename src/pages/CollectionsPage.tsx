import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Collection from "@/components/Collection";

export default function CollectionsPage() {
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
      <h1 className="text-3xl font-bold">My Collections</h1>
      <Collection userId={userId} />
    </div>
  );
}

