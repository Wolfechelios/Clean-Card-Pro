import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";
import { supabase } from "@/integrations/supabase/client";

export function isPasskeySupported(): boolean {
  return browserSupportsWebAuthn();
}

export async function hasPlatformAuthenticator(): Promise<boolean> {
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export async function registerPasskey(deviceLabel?: string): Promise<void> {
  const { data: opts, error: oErr } = await supabase.functions.invoke("passkey-register-options", {});
  if (oErr) throw oErr;
  const credential = await startRegistration({ optionsJSON: opts });
  const { error: vErr } = await supabase.functions.invoke("passkey-register-verify", {
    body: { credential, deviceLabel: deviceLabel ?? guessDeviceLabel() },
  });
  if (vErr) throw vErr;
}

export async function signInWithPasskey(email?: string, useBrowserAutofill = false): Promise<void> {
  const { data: opts, error: oErr } = await supabase.functions.invoke("passkey-auth-options", {
    body: { email },
  });
  if (oErr) throw oErr;
  const credential = await startAuthentication({ optionsJSON: opts, useBrowserAutofill });
  const { data: result, error: vErr } = await supabase.functions.invoke("passkey-auth-verify", {
    body: { credential },
  });
  if (vErr) throw vErr;
  const { access_token, refresh_token } = result as { access_token: string; refresh_token: string };
  const { error: sErr } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sErr) throw sErr;
}

function guessDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "This device";
}

const PK_FLAG = "cleancards.passkey.registered";

export function markPasskeyRegistered(userId: string) {
  try {
    const set = new Set(JSON.parse(localStorage.getItem(PK_FLAG) || "[]"));
    set.add(userId);
    localStorage.setItem(PK_FLAG, JSON.stringify([...set]));
  } catch {}
}

export function hasLocalPasskeyHint(): boolean {
  try {
    return JSON.parse(localStorage.getItem(PK_FLAG) || "[]").length > 0;
  } catch {
    return false;
  }
}
