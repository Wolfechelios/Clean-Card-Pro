

## Plan: Fix Storage Policies, Realtime RLS, and API Key Encryption

### Issue 1: Storage Write/Delete Policies

**Current state:** The previous migration added ownership-scoped UPDATE and DELETE policies that check `cards.image_storage_path = objects.name`, but INSERT is still wide open (`bucket_id = 'card-images'`). The UPDATE `with_check` is also not ownership-scoped.

**Problem with path-based ownership:** Edge functions use service role key (bypasses RLS), so their uploads work regardless. Client-side uploads use paths like `cards/{uuid}.jpg` — these don't include user ID in the path, so folder-based ownership (`foldername[1] = auth.uid()`) won't work without refactoring all upload paths.

**Fix:** Since edge functions use service role (bypass RLS) and client-side uploads are the concern:
- Tighten INSERT policy: client uploads always go to `cards/{cardId}.ext` — we can't restrict by user folder without a major path migration. Instead, we keep INSERT open for authenticated users (they need to upload their own scans) but tighten UPDATE/DELETE with the existing cards-table join.
- Fix the UPDATE `with_check` to also be ownership-scoped (currently it's just `bucket_id`).

**Migration SQL:**
```sql
-- Fix UPDATE with_check to be ownership-scoped too
DROP POLICY IF EXISTS "card_images_owner_update" ON storage.objects;
CREATE POLICY "card_images_owner_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'card-images' AND EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.user_id = auth.uid() AND cards.image_storage_path = name
  )
)
WITH CHECK (
  bucket_id = 'card-images' AND EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.user_id = auth.uid() AND cards.image_storage_path = name
  )
);
```

### Issue 2: Realtime Channel RLS

**Current state:** `cards` and `remote_scan_sessions` are in `supabase_realtime` publication. No policies on `realtime.messages`.

**Problem:** We cannot add RLS policies to `realtime.messages` — it's a Supabase-reserved schema. Modifying reserved schemas (`realtime`) can cause service degradation.

**Actual fix:** Supabase Realtime already respects the RLS policies on the source tables (`cards`, `remote_scan_sessions`). Both tables have user-scoped RLS (`auth.uid() = user_id`). So users can only receive change events for their own rows. The security scanner finding is misleading — this is already secure through table-level RLS. We should dismiss this finding.

### Issue 3: API Key Encryption (Vault)

**Problem:** Supabase Vault (`supabase_vault` extension) is not available in the Lovable Cloud environment. We cannot create or use vault functions.

**Alternative:** The keys are already protected by user-scoped RLS policies. To add defense-in-depth without Vault, we can encrypt keys at the application level using `pgcrypto` with a server-side secret before storing, and decrypt when reading in edge functions.

**Migration:**
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

**Edge function changes (`getUserApiKey.ts`):**
- When reading: decrypt using `pgp_sym_decrypt(key_value::bytea, secret)`
- When writing (via edge function or client): encrypt using `pgp_sym_encrypt(value, secret)`

**However** — this requires changing the `key_value` column type and updating all read/write paths. The encryption key would be the `SUPABASE_SERVICE_ROLE_KEY` (already a secret). This is moderate effort.

**Pragmatic recommendation:** The RLS is already tight. Application-level encryption adds marginal security for significant complexity. I recommend marking this as accepted risk with a note, unless you want me to implement pgcrypto encryption.

---

### Summary of changes

| Issue | Action |
|-------|--------|
| Storage UPDATE `with_check` not scoped | Migration: fix policy |
| Realtime messages RLS | No action needed — table-level RLS already protects realtime events |
| API key encryption | Implement pgcrypto-based encryption OR accept risk (your choice) |

### Files

| File | Action |
|------|--------|
| Migration SQL | Fix UPDATE policy `with_check` clause |

