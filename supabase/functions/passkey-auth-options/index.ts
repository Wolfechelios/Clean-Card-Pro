import { createClient } from "npm:@supabase/supabase-js@2";
import { generateAuthenticationOptions } from "npm:@simplewebauthn/server@10.0.1";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const email = (body as any)?.email as string | undefined;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let allowCredentials: { id: string; transports?: string[] }[] = [];
    let userIdForChallenge: string | null = null;

    if (email) {
      const { data: ures } = await admin.auth.admin.listUsers();
      const u = ures?.users?.find((x) => x.email?.toLowerCase() === email.toLowerCase());
      if (u) {
        userIdForChallenge = u.id;
        const { data: pks } = await admin
          .from("user_passkeys")
          .select("credential_id, transports")
          .eq("user_id", u.id);
        allowCredentials = (pks ?? []).map((p) => ({ id: p.credential_id, transports: p.transports ?? [] }));
      }
    }

    const origin = req.headers.get("origin") ?? "";
    const rpID = (() => { try { return new URL(origin).hostname; } catch { return "localhost"; } })();

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials: allowCredentials.map((c) => ({ id: c.id, transports: c.transports as any })),
    });

    await admin.from("passkey_challenges").insert({
      user_id: userIdForChallenge,
      challenge: options.challenge,
      kind: "auth",
      email: email ?? null,
    });

    return new Response(JSON.stringify(options), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("auth-options error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
