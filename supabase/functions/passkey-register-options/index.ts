import { createClient } from "npm:@supabase/supabase-js@2";
import { generateRegistrationOptions } from "npm:@simplewebauthn/server@10.0.1";
import { corsHeaders } from "../_shared/cors.ts";

function rpFromOrigin(origin: string): { rpID: string; origin: string } {
  try {
    const u = new URL(origin);
    return { rpID: u.hostname, origin: `${u.protocol}//${u.host}` };
  } catch {
    return { rpID: "localhost", origin };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: cErr } = await supabase.auth.getClaims(token);
    if (cErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claims.claims.sub as string;
    const email = (claims.claims.email as string | undefined) ?? "user";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: existing } = await admin
      .from("user_passkeys")
      .select("credential_id, transports")
      .eq("user_id", userId);

    const origin = req.headers.get("origin") ?? "";
    const { rpID } = rpFromOrigin(origin);

    const options = await generateRegistrationOptions({
      rpName: "Clean Cards",
      rpID,
      userID: new TextEncoder().encode(userId),
      userName: email,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        authenticatorAttachment: "platform",
      },
      excludeCredentials: (existing ?? []).map((c) => ({
        id: c.credential_id,
        transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
      })),
    });

    await admin.from("passkey_challenges").insert({
      user_id: userId,
      challenge: options.challenge,
      kind: "register",
    });

    return new Response(JSON.stringify(options), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("register-options error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

type AuthenticatorTransportFuture = "ble" | "internal" | "nfc" | "usb" | "cable" | "hybrid";
