import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Database } from "@/integrations/supabase/types";

type CardType = Database["public"]["Tables"]["cards"]["Row"];

export default function NewDashboard() {
  const [stats, setStats] = useState({
    totalCards: 0,
    totalValue: 0,
    recentScans: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return;

      const { data: cards } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", session.session.user.id);

      if (cards) {
        const totalValue = cards.reduce((sum, card) => {
          return sum + (card.current_price_raw || 0);
        }, 0);

        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentScans = cards.filter(c => {
          const scanDate = new Date(c.created_at);
          return scanDate > dayAgo;
        }).length;

        setStats({
          totalCards: cards.length,
          totalValue,
          recentScans,
        });
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <div className="text-sm text-neutral-400">Total Cards</div>
          <div className="text-3xl font-bold mt-2">{stats.totalCards}</div>
        </Card>

        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <div className="text-sm text-neutral-400">Total Value</div>
          <div className="text-3xl font-bold mt-2">${stats.totalValue.toFixed(2)}</div>
        </Card>

        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <div className="text-sm text-neutral-400">Recent Scans (24h)</div>
          <div className="text-3xl font-bold mt-2">{stats.recentScans}</div>
        </Card>
      </div>
    </div>
  );
}
