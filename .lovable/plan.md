

## Plan: Fix Pricing Accuracy — Use Firecrawl for Reliable Scraping

### Root Cause

The prices are way off because the current `fetch-card-prices` edge function scrapes eBay, TCGPlayer, and PriceCharting using raw `fetch()` calls — but these sites block or return incomplete HTML to simple HTTP requests. The function then runs generic regex over broken HTML, extracting wrong prices or nothing at all. Specific problems:

1. **eBay** returns bot-detection pages to raw fetch; `extractPricesFromHtml` uses a generic `$XX.XX` regex fallback that picks up shipping costs, unrelated prices, and page chrome — not sold prices
2. **PriceCharting** fetches the *search results page*, not the actual card page — regex then grabs random prices from multiple card listings
3. **TCGPlayer** is a Next.js SPA — raw fetch returns an empty shell with no price data; the __NEXT_DATA__ strategy fails on search pages
4. **PSA9/PSA10 fallback** uses hardcoded multipliers (2.5x, 4x raw) which are wildly inaccurate

The project already has **Firecrawl connected** (API key is set). Using Firecrawl for scraping returns clean markdown that's trivial to parse accurately.

### Changes

**1. Rewrite `supabase/functions/fetch-card-prices/index.ts` — use Firecrawl**

Replace raw `fetch()` scraping with Firecrawl's `/v1/scrape` endpoint for each source:

- **PriceCharting**: Build a direct card URL (not search) using `pricecharting.com/game/{category}/{card-name-slug}`. Scrape as markdown. Parse the pricing table which clearly shows "Ungraded", "Grade 9", "PSA 10" rows with dollar values. If direct URL fails, fall back to search page and follow the first result link.

- **eBay Sold**: Use Firecrawl to scrape the eBay sold listings URL. The markdown output cleanly separates each listing with its sold price, making extraction reliable. Compute true median from actual sold prices only.

- **TCGPlayer**: Use Firecrawl to scrape TCGPlayer product page. The markdown contains Market Price, Low, Mid, High clearly labeled. If search page, extract first product URL and scrape that.

- **Remove PSA multiplier fallbacks**: If actual graded prices aren't found on the page, return `null` instead of fabricating prices with 2.5x/4x multipliers. The UI already handles null gracefully.

**2. Improved PriceCharting URL builder**

Instead of always hitting the search page, build a direct product URL:
```text
https://www.pricecharting.com/game/{category}/{slug}
```
Where `slug` is derived from card name + set (lowercased, spaces to hyphens). This lands on the actual card page with the full pricing table.

**3. Better eBay sold price extraction from markdown**

Firecrawl markdown for eBay sold listings produces lines like:
```
$12.50 · Sold · Mar 15
```
Parse only lines containing "Sold" to get actual sold prices, then compute median. Ignore shipping, "Buy It Now", and other non-sold amounts.

**4. Remove all hardcoded graded multipliers**

Lines 141-151 and 245-248 apply `* 2.5`, `* 4`, `* 2.2`, `* 3.5` multipliers to estimate graded prices. These are fabricated and misleading. Replace with `null` — only return graded prices that are actually found on the source page.

### Technical Details

Firecrawl scrape call pattern (inside the edge function):
```typescript
const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: targetUrl,
    formats: ['markdown'],
    onlyMainContent: true,
    waitFor: 2000, // wait for dynamic content
  }),
});
const data = await resp.json();
const markdown = data?.data?.markdown || data?.markdown || '';
```

PriceCharting markdown table parsing:
```typescript
// Lines like: "| Ungraded | $2.50 |" or "Ungraded $2.50"
const ungradedMatch = md.match(/ungraded[^$]*\$([0-9,.]+)/i);
const psa9Match = md.match(/(?:psa\s*9|grade\s*9)[^$]*\$([0-9,.]+)/i);
const psa10Match = md.match(/(?:psa\s*10|gem\s*mint)[^$]*\$([0-9,.]+)/i);
```

### Files

| File | Action |
|------|--------|
| `supabase/functions/fetch-card-prices/index.ts` | Rewrite — use Firecrawl for all 3 sources, remove multiplier fallbacks, build direct PriceCharting URLs |

### What stays unchanged
All client-side code, adapters, consensus logic, queue processor, scanning, UI, and database schema remain intact. Only the server-side price fetching implementation changes.

