# Make Binder Camera Mode Visible

## The Problem

The "Capture Page" camera button **does exist** — it's wired up inside `BinderGrid.tsx` (line 105-112). But it's hidden behind two gates:

1. You must be **signed in** (you're currently on `/auth`)
2. You must **select a set** from the sidebar dropdown
3. That set must have **at least one card slot**

Until all three conditions are true, the page shows the empty state ("Select a set to view your binder") and the camera button never renders. That's why it looks like the feature is missing.

## The Fix

Move the "Capture Page" button out of `BinderGrid` and into the `BinderPage` header so it's **always visible** on the Binder page once you're signed in. Also add it to the empty state so a brand-new user can capture a page even before picking a set.

### Changes

**`src/pages/BinderPage.tsx`**
- Add a "Capture Page" button next to the "Binder Mode" header (top right of the page).
- Lift the `captureOpen` state up from `BinderGrid` to `BinderPage`.
- Render `<BinderPageCapture>` at the page level so it works regardless of whether a set is selected.
- Add a secondary "Capture a Binder Page" CTA button inside the empty state (when no set is selected) so the feature is discoverable immediately.

**`src/components/binder/BinderGrid.tsx`**
- Remove the local `captureOpen` state and the `<BinderPageCapture>` dialog (now lives in the parent).
- Keep a smaller "Capture Page" button in the page-indicator row as a convenience, but make it call a prop callback `onCaptureClick` instead.
- Accept `onCaptureClick` prop from `BinderPage`.

**`src/components/binder/BinderPageCapture.tsx`** *(no logic change)*
- Just confirm the `setName` prop is optional so it works from the empty state too.

### Result

- After signing in, visiting `/binder` shows a **"Capture Page" camera button in the header immediately** — no set selection required.
- The empty state also shows a prominent CTA button so first-time users see it.
- Once a set is picked, the existing in-grid button keeps working.

### How to access it after the fix

1. Sign in (you're on `/auth` right now)
2. Navigate to **Binder** in the sidebar (route `/binder`)
3. Tap the **Capture Page** camera button in the top-right of the Binder header

No DB changes. No new dependencies. Pure UI surfacing.
