import { supabase } from "@/integrations/supabase/client";

export type Recommendation = {
  type: "buy" | "sell" | "grade" | "protect";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  specificCards?: string[];
};

export type MarketTrend = {
  category: string;
  trend: "up" | "down" | "stable";
  description: string;
  impact: string;
};

export type ValueAnalysis = {
  currentValue: string;
  potentialValue: string;
  riskLevel: "low" | "medium" | "high";
  diversification: string;
  strengths: string[];
  weaknesses: string[];
};

export type CollectionInsights = {
  summary: string;
  recommendations: Recommendation[];
  marketTrends: MarketTrend[];
  valueAnalysis: ValueAnalysis | null;
};

export async function getCollectionInsights(): Promise<{
  insights: CollectionInsights;
  collectionStats: any;
}> {
  const { data, error } = await supabase.functions.invoke("collection-insights", {
    body: {},
  });

  if (error) {
    throw new Error(error.message || "Failed to get collection insights");
  }

  if (!data.success) {
    throw new Error(data.error || "Failed to analyze collection");
  }

  return {
    insights: data.insights,
    collectionStats: data.collectionStats,
  };
}
