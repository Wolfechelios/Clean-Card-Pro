// Shared JWT auth helper for edge functions.
// Returns { userId } on success, or a Response (401) on failure.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function requireAuth(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<{ userId: string; authHeader: string } | Response> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return { userId: data.claims.sub as string, authHeader };
  } catch {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// Allow service-role calls (server-to-server) to bypass user auth.
export function isServiceRoleRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.replace("Bearer ", "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return !!serviceKey && token === serviceKey;
}
