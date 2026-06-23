# Clean Card Pro App Cleanup Structure

This pass keeps the app focused on the workflows actually used.

## Main app shell

```txt
Dashboard
Rapid Scan
Cards / Collections
Binder
Price DB
Settings
```

## Hidden/redirected clutter

The following routes no longer load their heavy pages from the main app bundle. Existing bookmarks redirect to the closest useful page.

```txt
/install          → /dashboard
/graded           → /scan
/visual-search    → /scan
/price-hub        → /price-database
/image-backfill   → /settings
/import-cleaner   → /price-database
/help             → /settings
/sell-assist      → /collections
/deck-builder     → /collections
/insights         → /dashboard
/performance      → /dashboard
/predictions      → /dashboard
```

## Still kept

```txt
/mobile-scan
/mobile-scanner
```

These are kept because they support phone/remote scan workflows.

## Removed from default UI

```txt
Notification bell
PWA install banner
PWA onboarding modal
PWA update banner
AI Insights navigation
Performance navigation
Predictor navigation
Deck Builder navigation
Sell Assist navigation
Visual Search navigation
Graded navigation
Price Hub navigation
Help navigation
```

## Rule for future cleanup

Do not delete database tables or migrations during UI cleanup. First remove the UI entry point and route loading. Delete backend/data code only after the cleaned app builds and runs stable.
