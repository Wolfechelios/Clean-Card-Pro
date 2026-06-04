# Passkey auto-login for Clean Cards

Add WebAuthn passkeys (Face ID / Touch ID / Windows Hello / Android biometric) as the primary sign-in across the app, with "remember this device" so returning users tap once and are signed in.

## What the user sees

- **First visit** — sign in with email/password (kept as a fallback). After login, a banner offers: *"Set up Face ID / fingerprint on this device"*. One tap registers a passkey.
- **Return visits** — the `/auth` page auto-detects a registered passkey on the device and shows a big **"Sign in with Face ID"** button. On mobile with platform authenticator + previous session, it triggers automatically (conditional UI / autofill).
- **App load anywhere** — if a valid Lovable Cloud session is still in localStorage (the device is "remembered"), the user lands straight in the app. Sessions auto-refresh as today.
- **Settings → Security** — list registered passkeys per device, rename, remove.

## Technical design

### Database (one new table)
```
public.user_passkeys
  id uuid pk
  user_id uuid → auth.users (cascade)
  credential_id text unique         -- base64url
  public_key text                   -- base64url COSE key
  counter bigint default 0
  transports text[]                 -- ['internal','hybrid',...]
  device_label text                 -- "iPhone 15", user-editable
  created_at, last_used_at
```
RLS: user can only see/modify their own rows. Plus the standard GRANTs.

### Edge functions (verify_jwt = false for the two challenge endpoints, true for the rest)
- `passkey-register-options` — auth required. Returns `PublicKeyCredentialCreationOptions`, stores challenge in a short-lived `passkey_challenges` row.
- `passkey-register-verify` — auth required. Verifies attestation with `@simplewebauthn/server`, inserts row in `user_passkeys`.
- `passkey-auth-options` — public. Optional `email` to scope allowCredentials, otherwise returns discoverable-credential options.
- `passkey-auth-verify` — public. Verifies assertion, looks up `user_id`, mints a Supabase session via the admin API (`auth.admin.generateLink` → exchange) and returns `{ access_token, refresh_token }` which the client sets via `supabase.auth.setSession`.

### Client
- `src/lib/passkey.ts` — wraps `@simplewebauthn/browser` (`startRegistration`, `startAuthentication`).
- `src/components/auth/PasskeyButton.tsx` — used on `/auth`.
- `src/components/auth/PasskeySetupBanner.tsx` — appears after first email login if no passkey is registered for the device.
- `src/pages/Auth.tsx` — adds passkey button above email form; calls `navigator.credentials` conditional mediation on mount when supported so iOS/Android autofill the passkey.
- `src/components/settings/PasskeysManager.tsx` — list/rename/delete passkeys; wired into `SettingsPage`.
- `use-auth.tsx` — already persists sessions in localStorage with `autoRefreshToken`, so "device remember" works automatically. We only add the `setSession` call after a successful passkey assertion.

### Secrets
None new. Uses existing `SUPABASE_SERVICE_ROLE_KEY` inside the verify edge function to mint the session.

### Scope guardrails
- Email/password stays available as fallback (passkey can be lost with the device).
- No phone/SMS, no Twilio.
- No changes to scanner, pricing, or collection logic.

## Files touched
- new migration: `user_passkeys`, `passkey_challenges`, RLS, GRANTs
- new edge functions: `passkey-register-options`, `passkey-register-verify`, `passkey-auth-options`, `passkey-auth-verify`
- new: `src/lib/passkey.ts`, `src/components/auth/PasskeyButton.tsx`, `src/components/auth/PasskeySetupBanner.tsx`, `src/components/settings/PasskeysManager.tsx`
- edited: `src/pages/Auth.tsx`, `src/pages/SettingsPage.tsx`, `src/App.tsx` (mount setup banner once after login)
- dep: `@simplewebauthn/browser` (client), `npm:@simplewebauthn/server` in edge functions

Approve and I'll build it.