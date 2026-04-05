import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateImageUrl, SSRFError } from "../_shared/validateUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "Image URL required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const prompt = `Analyze this image of a graded trading card slab (PSA, CGC, or Beckett).
Extract the following information from the label:

1. GRADING COMPANY: Identify if this is PSA (red label), CGC (blue label), or Beckett (orange/tan label)
2. CERT/SERIAL NUMBER: The unique certification number on the label (usually 8-10 digits for PSA, 10+ for CGC)
3. GRADE: The numeric grade (e.g., 10, 9.5, 9, 8.5, etc.) and any qualifier (e.g., "GEM MINT", "MINT", "NM-MT")
4. CARD NAME: The player name or character name on the label
5. CARD SET: The set/product name (e.g., "2020 Topps Chrome", "1999 Pokemon Base Set")
6. CARD NUMBER: The card number if visible
7. YEAR: The year of the card

Return ONLY valid JSON in this exact format:
{
  "gradingCompany": "PSA" | "CGC" | "Beckett" | null,
  "certNumber": "string or empty",
  "grade": "string (e.g., '10', '9.5', 'GEM MINT 10')",
  "cardName": "string",
  "cardSet": "string",
  "cardNumber": "string",
  "year": "string"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", response.status, errorText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Parse error:", parseError, "Content:", content);
      parsed = {
        gradingCompany: null,
        certNumber: "",
        grade: "",
        cardName: "",
        cardSet: "",
        cardNumber: "",
        year: "",
      };
    }

    console.log("Analyzed graded card:", parsed);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error analyzing graded card:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});