import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAIGateway } from "../_shared/aiGateway.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get the user's cards
    const { data: cards, error: cardsError } = await supabaseClient
      .from('cards')
      .select('*')
      .order('created_at', { ascending: false });

    if (cardsError) {
      throw cardsError;
    }

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          insights: {
            summary: 'No cards in collection yet. Start scanning cards to get personalized insights!',
            recommendations: [],
            marketTrends: [],
            valueAnalysis: null
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`Analyzing collection of ${cards.length} cards...`);

    // Prepare collection summary for AI
    const totalCardsCount = cards.reduce((sum, card) => sum + (card.quantity || 1), 0);
    const totalValueCalc = cards.reduce((sum, card) => sum + (card.current_price_raw || 0) * (card.quantity || 1), 0);
    const collectionSummary = {
      totalCards: totalCardsCount,
      totalValue: totalValueCalc,
      avgValue: totalCardsCount > 0 ? totalValueCalc / totalCardsCount : 0,
      rarityDistribution: cards.reduce((acc, card) => {
        const rarity = card.rarity || 'Unknown';
        acc[rarity] = (acc[rarity] || 0) + (card.quantity || 1);
        return acc;
      }, {} as Record<string, number>),
      gameTypes: [...new Set(cards.map(c => c.game_type).filter(Boolean))],
      sportTypes: [...new Set(cards.map(c => c.sport_type).filter(Boolean))],
      topCards: cards
        .filter(c => c.current_price_raw)
        .sort((a, b) => (b.current_price_raw || 0) - (a.current_price_raw || 0))
        .slice(0, 10)
        .map(c => ({
          name: c.card_name,
          set: c.card_set,
          value: c.current_price_raw,
          condition: c.condition
        })),
      recentAdditions: cards.slice(0, 5).map(c => ({
        name: c.card_name,
        set: c.card_set,
        value: c.current_price_raw,
        addedAt: c.created_at
      }))
    };

    const prompt = `You are an expert trading card collection advisor. Analyze this collection and provide detailed insights.

Collection Summary:
${JSON.stringify(collectionSummary, null, 2)}

Provide your analysis in the following JSON format:

{
  "summary": "2-3 sentence overview of the collection",
  "recommendations": [
    {
      "type": "buy|sell|grade|protect",
      "title": "Recommendation title",
      "description": "Detailed explanation",
      "priority": "high|medium|low",
      "specificCards": ["card names if applicable"]
    }
  ],
  "marketTrends": [
    {
      "category": "category name",
      "trend": "up|down|stable",
      "description": "What's happening in this market",
      "impact": "How it affects this collection"
    }
  ],
  "valueAnalysis": {
    "currentValue": "estimated current value",
    "potentialValue": "potential future value",
    "riskLevel": "low|medium|high",
    "diversification": "assessment of collection diversity",
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"]
  }
}

Focus on actionable insights, market opportunities, and risk management.`;

    const response = await callAIGateway({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are an expert trading card collection advisor with deep knowledge of sports cards, Pokemon, MTG, and other collectibles. Provide actionable insights based on market trends and collection analysis.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
      });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in AI response');
    }

    // Parse the JSON response
    let insights;
    try {
      const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) || content.match(/```\n([\s\S]+?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      insights = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse AI response as JSON:', content);
      throw new Error('Failed to parse insights response');
    }

    console.log('Insights generated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        insights,
        collectionStats: collectionSummary,
        rawResponse: content
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in collection-insights:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
