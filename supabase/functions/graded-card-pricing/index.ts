import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CardIdentifier {
  set?: string;
  year?: string;
  player?: string;
  name?: string;
  card_number?: string;
  variant?: string;
}

interface PricingOptions {
  grader?: string;
  grade?: string;
  force_refresh?: boolean;
}

interface NormalizedComp {
  provider: string;
  grader: string;
  grade: string;
  sale_price_USD: number;
  sale_date: string;
  currency: string;
  shipping: number;
  seller_name: string;
  marketplace_id: string;
  raw_response: Record<string, unknown>;
  ts: string;
}

interface PopulationData {
  PSA: Record<string, number>;
  BGS: Record<string, number>;
  CGC: Record<string, number>;
}

interface PricingResponse {
  canonical_card: CardIdentifier;
  aggregated: {
    price_USD: number;
    price_type: string;
    confidence_score: number;
  };
  comps: NormalizedComp[];
  populations: PopulationData;
  providers: { name: string; status: string; error?: string }[];
  notes: string[];
  last_updated: string;
}

// Mock data generators (replace with real API calls when keys available)
function generateMockEbayComps(card: CardIdentifier, grader: string, grade: string): NormalizedComp[] {
  const basePrice = getBasePrice(card);
  const gradeMultiplier = getGradeMultiplier(grader, grade);
  const count = Math.floor(Math.random() * 8) + 3;
  
  return Array.from({ length: count }, (_, i) => {
    const variance = 0.8 + Math.random() * 0.4;
    const daysAgo = Math.floor(Math.random() * 365);
    const saleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    
    return {
      provider: "eBay",
      grader,
      grade,
      sale_price_USD: Math.round(basePrice * gradeMultiplier * variance * 100) / 100,
      sale_date: saleDate.toISOString(),
      currency: "USD",
      shipping: Math.random() > 0.5 ? 0 : Math.round(Math.random() * 10 * 100) / 100,
      seller_name: `seller_${Math.random().toString(36).slice(2, 8)}`,
      marketplace_id: `ebay_${Date.now()}_${i}`,
      raw_response: {},
      ts: new Date().toISOString(),
    };
  });
}

function generateMockAuctionComps(card: CardIdentifier, grader: string, grade: string, provider: string): NormalizedComp[] {
  const basePrice = getBasePrice(card);
  const gradeMultiplier = getGradeMultiplier(grader, grade);
  const count = Math.floor(Math.random() * 3) + 1;
  
  return Array.from({ length: count }, (_, i) => {
    const variance = 0.9 + Math.random() * 0.3;
    const daysAgo = Math.floor(Math.random() * 180) + 30;
    const saleDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    
    return {
      provider,
      grader,
      grade,
      sale_price_USD: Math.round(basePrice * gradeMultiplier * variance * 1.1 * 100) / 100,
      sale_date: saleDate.toISOString(),
      currency: "USD",
      shipping: 0,
      seller_name: provider,
      marketplace_id: `${provider.toLowerCase()}_${Date.now()}_${i}`,
      raw_response: {},
      ts: new Date().toISOString(),
    };
  });
}

function getBasePrice(card: CardIdentifier): number {
  // Simulate different base prices based on card characteristics
  const yearFactor = card.year ? (2024 - parseInt(card.year)) * 0.5 + 50 : 100;
  const nameFactor = card.player || card.name ? 1.5 : 1;
  return yearFactor * nameFactor + Math.random() * 50;
}

function getGradeMultiplier(grader: string, grade: string): number {
  const gradeNum = parseFloat(grade);
  const baseMultiplier = Math.pow(1.8, gradeNum - 7);
  
  const graderBonus: Record<string, number> = {
    PSA: 1.0,
    BGS: gradeNum >= 9.5 ? 1.15 : 0.95,
    CGC: 0.9,
  };
  
  return baseMultiplier * (graderBonus[grader] || 1);
}

function generateMockPopulation(grader: string): Record<string, number> {
  const grades = grader === "PSA" 
    ? ["10", "9", "8", "7", "6"]
    : ["10", "9.5", "9", "8.5", "8"];
  
  const pop: Record<string, number> = {};
  let remaining = Math.floor(Math.random() * 5000) + 500;
  
  grades.forEach((g, i) => {
    const count = i === 0 
      ? Math.floor(remaining * 0.05)
      : Math.floor(remaining * (0.15 + Math.random() * 0.1));
    pop[g] = count;
    remaining -= count;
  });
  
  return pop;
}

function computeWeightedPrice(comps: NormalizedComp[]): number {
  if (comps.length === 0) return 0;
  
  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;
  
  const providerTrust: Record<string, number> = {
    "PWCC": 1.2,
    "Goldin": 1.15,
    "Heritage": 1.1,
    "eBay": 0.9,
    "CardLadder": 1.0,
  };
  
  comps.forEach(comp => {
    const daysAgo = (now - new Date(comp.sale_date).getTime()) / (1000 * 60 * 60 * 24);
    const recencyWeight = Math.exp(-daysAgo / 180);
    const trustWeight = providerTrust[comp.provider] || 1;
    const weight = recencyWeight * trustWeight;
    
    weightedSum += comp.sale_price_USD * weight;
    totalWeight += weight;
  });
  
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function computeScarcityBoost(population: number): number {
  return 1 / Math.log10(1 + Math.max(population, 1));
}

function computeConfidenceScore(comps: NormalizedComp[], providers: { status: string }[]): number {
  let score = 0;
  
  // Factor 1: Number of comps (up to 0.4)
  score += Math.min(comps.length / 10, 0.4);
  
  // Factor 2: Recency of comps (up to 0.3)
  const recentComps = comps.filter(c => {
    const daysAgo = (Date.now() - new Date(c.sale_date).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo < 90;
  });
  score += (recentComps.length / Math.max(comps.length, 1)) * 0.3;
  
  // Factor 3: Provider diversity (up to 0.3)
  const uniqueProviders = new Set(comps.map(c => c.provider)).size;
  const successfulProviders = providers.filter(p => p.status === "success").length;
  score += (uniqueProviders / Math.max(successfulProviders, 1)) * 0.3;
  
  return Math.round(score * 100) / 100;
}

function generateCacheKey(card: CardIdentifier, grader?: string, grade?: string): string {
  const parts = [
    card.set || "",
    card.year || "",
    card.player || card.name || "",
    card.card_number || "",
    card.variant || "",
    grader || "all",
    grade || "all",
  ];
  return parts.join("|").toLowerCase().replace(/\s+/g, "_");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { card, options = {} }: { card: CardIdentifier; options?: PricingOptions } = await req.json();

    if (!card || (!card.set && !card.player && !card.name)) {
      return new Response(
        JSON.stringify({ error: "Card identifier required (set, player/name, or card_number)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { grader, grade, force_refresh = false } = options;
    const cacheKey = generateCacheKey(card, grader, grade);
    const cacheTTL = 6 * 60 * 60 * 1000; // 6 hours

    // Check cache unless force refresh
    if (!force_refresh) {
      const { data: cached } = await supabase
        .from("graded_pricing_cache")
        .select("*")
        .eq("cache_key", cacheKey)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (cached) {
        console.log("Cache hit for:", cacheKey);
        return new Response(JSON.stringify(cached.response_data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch grader premiums
    const { data: premiums } = await supabase
      .from("grader_premiums")
      .select("*");

    const premiumMap: Record<string, number> = {};
    premiums?.forEach(p => {
      premiumMap[`${p.grader}_${p.grade}`] = p.premium_multiplier;
    });

    // Determine which graders/grades to query
    const graders = grader ? [grader] : ["PSA", "BGS", "CGC"];
    const grades = grade 
      ? [grade] 
      : grader === "PSA" 
        ? ["10", "9", "8", "7"]
        : ["10", "9.5", "9", "8.5", "8"];

    const providers: { name: string; status: string; error?: string }[] = [];
    const allComps: NormalizedComp[] = [];
    const notes: string[] = [];

    // Simulate parallel API calls
    const apiCalls = [
      // eBay
      (async () => {
        try {
          // const ebayKey = Deno.env.get("EBAY_APP_ID");
          // Real implementation would use eBay API here
          for (const g of graders) {
            for (const gr of grades) {
              allComps.push(...generateMockEbayComps(card, g, gr));
            }
          }
          providers.push({ name: "eBay", status: "success" });
        } catch (e) {
          providers.push({ name: "eBay", status: "error", error: String(e) });
        }
      })(),
      
      // PWCC
      (async () => {
        try {
          for (const g of graders) {
            for (const gr of grades) {
              if (Math.random() > 0.3) {
                allComps.push(...generateMockAuctionComps(card, g, gr, "PWCC"));
              }
            }
          }
          providers.push({ name: "PWCC", status: "success" });
        } catch (e) {
          providers.push({ name: "PWCC", status: "error", error: String(e) });
        }
      })(),
      
      // Goldin
      (async () => {
        try {
          for (const g of graders) {
            for (const gr of grades) {
              if (Math.random() > 0.5) {
                allComps.push(...generateMockAuctionComps(card, g, gr, "Goldin"));
              }
            }
          }
          providers.push({ name: "Goldin", status: "success" });
        } catch (e) {
          providers.push({ name: "Goldin", status: "error", error: String(e) });
        }
      })(),
      
      // Heritage
      (async () => {
        try {
          for (const g of graders) {
            for (const gr of grades) {
              if (Math.random() > 0.6) {
                allComps.push(...generateMockAuctionComps(card, g, gr, "Heritage"));
              }
            }
          }
          providers.push({ name: "Heritage", status: "success" });
        } catch (e) {
          providers.push({ name: "Heritage", status: "error", error: String(e) });
        }
      })(),
    ];

    await Promise.all(apiCalls);

    // Generate population data
    const populations: PopulationData = {
      PSA: generateMockPopulation("PSA"),
      BGS: generateMockPopulation("BGS"),
      CGC: generateMockPopulation("CGC"),
    };

    // Filter comps by requested grader/grade if specified
    const filteredComps = allComps.filter(c => {
      if (grader && c.grader !== grader) return false;
      if (grade && c.grade !== grade) return false;
      return true;
    });

    // Sort by date (most recent first)
    filteredComps.sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime());

    // Compute aggregated price
    const recentWeightedPrice = computeWeightedPrice(filteredComps);
    
    // Get population for scarcity calculation
    const targetGrader = grader || "PSA";
    const targetGrade = grade || "10";
    const popCount = populations[targetGrader as keyof PopulationData]?.[targetGrade] || 100;
    const scarcityBoost = computeScarcityBoost(popCount);
    
    // Get grader premium
    const graderPremium = premiumMap[`${targetGrader}_${targetGrade}`] || 1;
    
    // Calculate final price
    const aggregatedPrice = recentWeightedPrice * (1 + scarcityBoost * 0.1) * graderPremium;
    const confidenceScore = computeConfidenceScore(filteredComps, providers);

    // Add notes based on data quality
    if (filteredComps.length < 5) {
      notes.push("Low sample size - estimate may be less accurate");
    }
    if (confidenceScore < 0.5) {
      notes.push("Limited market data available");
    }
    if (!grader) {
      notes.push("Showing prices across all graders");
    }

    const response: PricingResponse = {
      canonical_card: card,
      aggregated: {
        price_USD: Math.round(aggregatedPrice * 100) / 100,
        price_type: "market_average",
        confidence_score: confidenceScore,
      },
      comps: filteredComps.slice(0, 50), // Limit to 50 most recent
      populations,
      providers,
      notes,
      last_updated: new Date().toISOString(),
    };

    // Cache the response
    const expiresAt = new Date(Date.now() + cacheTTL).toISOString();
    await supabase
      .from("graded_pricing_cache")
      .upsert({
        cache_key: cacheKey,
        card_identifier: card,
        grader: grader || null,
        grade: grade || null,
        response_data: response,
        expires_at: expiresAt,
      }, { onConflict: "cache_key" });

    console.log(`Pricing computed for ${cacheKey}: $${response.aggregated.price_USD}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Graded pricing error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});