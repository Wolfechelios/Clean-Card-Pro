import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyRegistrationResponse } from "npm:@simplewebauthn/server@10.0.1";
import { corsHeaders } from "../_shared/cors.ts";

function rpFromOrigin(origin: string): { rpID: string; origin: string } {
  const u = new URL(origin);
  return { rpID: u.hostname, origin: `${u.protocol}//${u.host}` };
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

    const body = await req.json();
    const { credential, deviceLabel } = body as { credential: any; deviceLabel?: string };
    if (!credential) {
      return new Response(JSON.stringify({ error: "Missing credential" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: chRow } = await admin
      .from("passkey_challenges")
      .select("*")
      .eq("user_id", userId)
      .eq("kind", "register")
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!chRow) {
      return new Response(JSON.stringify({ error: "Challenge expired" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const origin = req.headers.get("origin") ?? "";
    const { rpID, origin: expectedOrigin } = rpFromOrigin(origin);

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: chRow.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return new Response(JSON.stringify({ error: "Verification failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { credential: regCred, credentialBackedUp } = verification.registrationInfo as any;
    const credentialID: string = regCred.id;
    const credentialPublicKey: Uint8Array = regCred.publicKey;
    const counter: number = regCred.counter ?? 0;

    const { error: insErr } = await admin.from("user_passkeys").insert({
      user_id: userId,
      credential_id: credentialID,
      public_key: bytesToB64url(credentialPublicKey),
      counter,
      transports: credential.response?.transports ?? [],
      device_label: deviceLabel || "This device",
      backed_up: !!credentialBackedUp,
    });

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("passkey_challenges").delete().eq("id", chRow.id);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("register-verify error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
