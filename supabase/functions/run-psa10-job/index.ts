import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10; // Process 10 cards in parallel
const DELAY_BETWEEN_BATCHES = 500; // 500ms between batches
const MAX_CARDS_PER_JOB = 100; // Process more cards per job
const SINGLE_CARD_TIMEOUT = 10000; // 10 second timeout per card

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id, limit, use_estimation, card_ids } = await req.json();
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "job_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cardLimit = Math.min(limit || MAX_CARDS_PER_JOB, MAX_CARDS_PER_JOB);
    const skipApi = use_estimation === true;

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

    let cards: { id: string }[] = [];

    // If card_ids provided, use those; otherwise query for cards needing update
    if (card_ids && Array.isArray(card_ids) && card_ids.length > 0) {
      // Use provided card IDs (limited to MAX_CARDS_PER_JOB)
      const limitedIds = card_ids.slice(0, cardLimit);
      cards = limitedIds.map((id: string) => ({ id }));
      console.log(`Using ${cards.length} provided card IDs`);
    } else {
      // Fallback: get cards that need updating
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const { data: queriedCards, error: cardsError } = await supabase
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

      cards = queriedCards || [];
    }

    const totalCards = cards.length;
    
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

    console.log(`Processing ${totalCards} cards for job ${job_id}, skipApi=${skipApi}`);

    // Process cards in batches
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < cards.length; i += BATCH_SIZE) {
      const batch = cards.slice(i, i + BATCH_SIZE);
      const startTime = Date.now();
      
      const results = await Promise.allSettled(batch.map(async (card) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SINGLE_CARD_TIMEOUT);
        
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/get-psa10-price`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ card_id: card.id, skip_api: skipApi }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            return { success: true, cardId: card.id };
          } else {
            const error = await response.text();
            console.error(`Failed to update card ${card.id}:`, error);
            return { success: false, cardId: card.id, error };
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === 'AbortError') {
            console.log(`Card ${card.id} timed out, skipping`);
          } else {
            console.error(`Error processing card ${card.id}:`, error);
          }
          return { success: false, cardId: card.id, error: 'timeout' };
        }
      }));

      // Count successes and failures
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          processed++;
        } else {
          errors++;
        }
      }

      const batchTime = Date.now() - startTime;
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} cards in ${batchTime}ms`);

      // Update progress
      await supabase
        .from("price_jobs")
        .update({ 
          processed_count: processed,
          updated_at: new Date().toISOString()
        })
        .eq("id", job_id);

      // Delay between batches
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

    console.log(`Job ${job_id} completed: ${processed}/${totalCards} cards, ${errors} errors`);

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
