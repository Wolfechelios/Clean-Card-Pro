import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { encryptValue, decryptValue } from "../_shared/apiKeyCrypto.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { action } = body;

    if (action === "list") {
      const { data, error } = await adminClient
        .from("user_api_keys")
        .select("id, key_name, key_value, is_active, created_at")
        .eq("user_id", user.id)
        .order("key_name");

      if (error) throw error;

      // Decrypt values, return masked
      const keys = await Promise.all(
        (data || []).map(async (k) => {
          let displayValue = k.key_value;
          try {
            displayValue = await decryptValue(k.key_value);
          } catch {
            // Legacy plaintext value — still works
          }
          const masked =
            displayValue.length <= 8
              ? "••••••••"
              : displayValue.slice(0, 4) + "••••••••" + displayValue.slice(-4);
          return { id: k.id, key_name: k.key_name, masked_value: masked, is_active: k.is_active, created_at: k.created_at };
        })
      );

      return new Response(JSON.stringify({ keys }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "save") {
      const { key_name, key_value } = body;
      if (!key_name || !key_value?.trim()) {
        return new Response(JSON.stringify({ error: "Missing key_name or key_value" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const ALLOWED_KEYS = ["GEMINI_API_KEY", "GOOGLE_VISION_API_KEY", "PERPLEXITY_API_KEY"];
      if (!ALLOWED_KEYS.includes(key_name)) {
        return new Response(JSON.stringify({ error: "Invalid key name" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const encrypted = await encryptValue(key_value.trim());

      // Upsert
      const { data: existing } = await adminClient
        .from("user_api_keys")
        .select("id")
        .eq("user_id", user.id)
        .eq("key_name", key_name)
        .maybeSingle();

      if (existing) {
        const { error } = await adminClient
          .from("user_api_keys")
          .update({ key_value: encrypted, is_active: true })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await adminClient
          .from("user_api_keys")
          .insert({ user_id: user.id, key_name, key_value: encrypted, is_active: true });
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "toggle") {
      const { key_id, is_active } = body;
      if (!key_id) {
        return new Response(JSON.stringify({ error: "Missing key_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await adminClient
        .from("user_api_keys")
        .update({ is_active: !!is_active })
        .eq("id", key_id)
        .eq("user_id", user.id);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { key_id } = body;
      if (!key_id) {
        return new Response(JSON.stringify({ error: "Missing key_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await adminClient
        .from("user_api_keys")
        .delete()
        .eq("id", key_id)
        .eq("user_id", user.id);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("manage-api-keys error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
