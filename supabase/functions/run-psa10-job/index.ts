import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 5; // Smaller batches for faster progress updates
const DELAY_BETWEEN_BATCHES = 1000; // 1 second between batches
const MAX_CARDS_PER_JOB = 50; // Limit cards per job for faster completion

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id, limit } = await req.json();
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "job_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cardLimit = Math.min(limit || MAX_CARDS_PER_JOB, MAX_CARDS_PER_JOB);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the job
    const { data: job, error: jobError } = await supabase
      .from("price_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update job to running
    await supabase
      .from("price_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job_id);

    // Get cards that need updating
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { data: cards, error: cardsError } = await supabase
      .from("cards")
      .select("id")
      .eq("user_id", job.user_id)
      .or(`psa10_locked.is.null,psa10_locked.eq.false`)
      .or(`psa10_updated_at.is.null,psa10_updated_at.lt.${twentyFourHoursAgo.toISOString()}`)
      .limit(cardLimit);

    if (cardsError) {
      await supabase
        .from("price_jobs")
        .update({ 
          status: "failed", 
          error: cardsError.message,
          updated_at: new Date().toISOString() 
        })
        .eq("id", job_id);
      
      return new Response(
        JSON.stringify({ error: cardsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalCards = cards?.length || 0;
    
    // Update requested count
    await supabase
      .from("price_jobs")
      .update({ requested_count: totalCards })
      .eq("id", job_id);

    if (totalCards === 0) {
      await supabase
        .from("price_jobs")
        .update({ 
          status: "done", 
          processed_count: 0,
          updated_at: new Date().toISOString() 
        })
        .eq("id", job_id);
      
      return new Response(
        JSON.stringify({ message: "No cards to update", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process cards in batches
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < cards.length; i += BATCH_SIZE) {
      const batch = cards.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (card) => {
        try {
          // Call get-psa10-price for each card
          const response = await fetch(`${supabaseUrl}/functions/v1/get-psa10-price`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ card_id: card.id })
          });
          
          if (response.ok) {
            processed++;
          } else {
            errors++;
            console.error(`Failed to update card ${card.id}:`, await response.text());
          }
        } catch (error) {
          errors++;
          console.error(`Error processing card ${card.id}:`, error);
        }
      }));

      // Update progress
      await supabase
        .from("price_jobs")
        .update({ 
          processed_count: processed,
          updated_at: new Date().toISOString()
        })
        .eq("id", job_id);

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < cards.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    // Mark job as done
    await supabase
      .from("price_jobs")
      .update({ 
        status: "done",
        processed_count: processed,
        error: errors > 0 ? `${errors} cards failed to update` : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(
      JSON.stringify({ 
        message: "Job completed",
        processed,
        errors,
        total: totalCards
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("run-psa10-job error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
