import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyAuthenticationResponse } from "npm:@simplewebauthn/server@10.0.1";
import { corsHeaders } from "../_shared/cors.ts";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { credential } = await req.json();
    if (!credential?.id) {
      return new Response(JSON.stringify({ error: "Missing credential" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: pk } = await admin
      .from("user_passkeys")
      .select("*")
      .eq("credential_id", credential.id)
      .maybeSingle();

    if (!pk) {
      return new Response(JSON.stringify({ error: "Unknown passkey" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: chRow } = await admin
      .from("passkey_challenges")
      .select("*")
      .eq("kind", "auth")
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!chRow) {
      return new Response(JSON.stringify({ error: "Challenge expired" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const origin = req.headers.get("origin") ?? "";
    const rpID = (() => { try { return new URL(origin).hostname; } catch { return "localhost"; } })();

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: chRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: pk.credential_id,
        publicKey: b64urlToBytes(pk.public_key),
        counter: Number(pk.counter ?? 0),
        transports: (pk.transports ?? []) as any,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return new Response(JSON.stringify({ error: "Verification failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin
      .from("user_passkeys")
      .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
      .eq("id", pk.id);
    await admin.from("passkey_challenges").delete().eq("id", chRow.id);

    // Mint a session for this user via a one-time magic link, then exchange to tokens.
    const { data: userResp, error: uErr } = await admin.auth.admin.getUserById(pk.user_id);
    if (uErr || !userResp?.user?.email) {
      return new Response(JSON.stringify({ error: "User missing email" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userResp.user.email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      return new Response(JSON.stringify({ error: linkErr?.message ?? "Link error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: vData, error: vErr } = await anon.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    });
    if (vErr || !vData?.session) {
      return new Response(JSON.stringify({ error: vErr?.message ?? "OTP verify failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({
        access_token: vData.session.access_token,
        refresh_token: vData.session.refresh_token,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("auth-verify error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
