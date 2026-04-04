

## Plan: Add Large Card Image Preview on Tap in Rapid Scan List

### Problem
When you tap a card in the scanned card list at the bottom of rapid scan, there's no way to see a larger version of the card image. The thumbnail is only 56×80px (`w-14 h-20`).

### Solution
Add a tap-to-preview behavior: tapping the card thumbnail opens a full-screen overlay/dialog showing the card image at a much larger size, along with the card name and key details.

### Changes

**`src/components/scanner/ScannedCardList.tsx`**

1. Add a `previewCard` state (`ScannedCard | null`) to track which card's image is being previewed
2. Make the thumbnail image clickable — on tap, set `previewCard` to that card
3. Add a Dialog/overlay at the bottom of the component that renders:
   - The card image at near-full-screen size (max-w-sm, max-h-[80vh], object-contain)
   - Card name, set, number, and price as a small overlay caption
   - Tap anywhere or X button to dismiss
4. Keep the existing checkbox, edit, and delete interactions unchanged — only the image itself triggers the preview

### Technical Details
- New state: `const [previewCard, setPreviewCard] = useState<ScannedCard | null>(null)`
- The thumbnail `<img>` gets an `onClick={() => setPreviewCard(card)}` with `cursor-pointer`
- Preview renders inside a `<Dialog>` with `DialogContent` sized for large image display
- Image source uses same logic: `card.imageUrl ? toPublicImageUrl(card.imageUrl) : card.preview`

### Files

| File | Action |
|------|--------|
| `src/components/scanner/ScannedCardList.tsx` | Edit — add preview state, clickable thumbnail, large image dialog |

