// Local-first single-card scanner hook.
// No Supabase storage uploads, no edge function calls, no remote DB reads.
// OCR + identification + duplicate check + save all run against local browser storage.

import { useState, useCallback, useRef } from "react";
import { insertCardDual, getAllCards } from "@/lib/localCards";
import { toast } from "sonner";
import { getScannerSettings, type ScanMode } from "./use-scanner-settings";
import { addRecentScan } from "@/lib/recentScans";
import { singleScanDetector } from "@/lib/scanAnomalyDetector";
import { analyzeMtgIdentification, buildMtgNotes } from "@/lib/mtg/alphaBetaDetector";
import { runLocalCardOcr } from "@/lib/ocr/localCardOcr";
import { compactOcrText, runRapidBasicLookup } from "@/lib/rapidBasicLookupClient";
import { withTimeout } from "@/lib/async/withTimeout";

export interface OCRResult {
  cardName: string;
  cardSet: string;
  cardNumber: string;
  confidence: number;
  rawText: string;
}

export interface IdentifiedCard {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  edition: string | null;
  game_type: string | null;
  sport_type: string | null;
  year: string | null;
  manufacturer: string | null;
  confidence: number;
  description: string;
}

export interface Alternative {
  card_name: string;
  card_set: string;
  confidence: number;
  reason: string;
}

export interface PendingCardData {
  identifiedCard: IdentifiedCard;
  alternatives: Alternative[];
  imageUrl: string;
  fallbackData?: any;

  scanMode?: ScanMode;
  ownedCount?: number;
  isInLibrary?: boolean;
  existingCard?: {
    id: string;
    card_name: string;
    card_set: string | null;
    image_url: string;
    current_price_raw: number | null;
  };

  isDuplicate?: boolean;
}

interface UseCardScannerOptions {
  userId: string;
  onScanComplete?: () => void;
  skipDuplicateCheck?: boolean;
}

const LOCAL_OCR_TIMEOUT_MS = 18000;
const LOCAL_LOOKUP_TIMEOUT_MS = 8000;

function normalize(s: string) {
  return (s || "").toLowerCase().trim();
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

export function useCardScanner({
  userId,
  onScanComplete,
  skipDuplicateCheck = false,
}: UseCardScannerOptions) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [pendingCard, setPendingCard] = useState<PendingCardData | null>(null);
  const [duplicateCard, setDuplicateCard] = useState<PendingCardData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const scanLockRef = useRef(false);

  // Local duplicate check — scans local cards store, never touches network.
  const checkForDuplicate = async (
    cardName: string,
    cardSet: string | null,
  ): Promise<{
    isDuplicate: boolean;
    ownedCount: number;
    existingCard?: PendingCardData["existingCard"];
  }> => {
    if (skipDuplicateCheck) return { isDuplicate: false, ownedCount: 0 };
    try {
      const all = await getAllCards();
      const nName = normalize(cardName);
      const nSet = normalize(cardSet || "");
      const matches = all.filter((c: any) => {
        const eName = normalize(c.card_name);
        if (eName !== nName) return false;
        const eSet = normalize(c.card_set || "");
        if (!nSet || !eSet) return true;
        if (eSet === nSet) return true;
        return eSet.includes(nSet) || nSet.includes(eSet);
      });
      if (matches.length === 0) return { isDuplicate: false, ownedCount: 0 };
      const first: any = matches[0];
      return {
        isDuplicate: true,
        ownedCount: matches.length,
        existingCard: {
          id: first.id,
          card_name: first.card_name,
          card_set: first.card_set ?? null,
          image_url: first.image_url ?? "",
          current_price_raw: first.current_price_raw ?? null,
        },
      };
    } catch (err) {
      console.error("Local duplicate check error:", err);
      return { isDuplicate: false, ownedCount: 0 };
    }
  };

  const handleScan = async () => {
    if (scanLockRef.current || isScanning) {
      toast.info("Scan already running");
      return;
    }
    if (!file || !preview) {
      toast.error("Please select an image first");
      return;
    }

    scanLockRef.current = true;
    setIsScanning(true);
    setScanProgress(0);

    const { scanMode, autoConfirmEnabled, autoConfirmThreshold, gameTypeFilter } = getScannerSettings();
    const gameTypeHint = gameTypeFilter !== "auto" ? gameTypeFilter : undefined;

    try {
      // Use the local data URL directly — no upload before we display a result.
      const imageUrl = preview;
      setScanProgress(20);

      // Local, offline OCR.
      const ocr = await withTimeout(runLocalCardOcr(file), LOCAL_OCR_TIMEOUT_MS, "Local OCR");
      const ocrText = compactOcrText(ocr?.setCode, ocr?.cardNumber, ocr?.title, ocr?.fullCode, ocr?.rawText);
      const legacyOcr: OCRResult = {
        cardName: ocr?.title || "Unknown Card",
        cardSet: ocr?.setCode || "",
        cardNumber: ocr?.cardNumber || ocr?.fullCode || "",
        confidence: Math.round((ocr?.confidence ?? 0.5) * 100),
        rawText: ocr?.rawText || ocrText,
      };
      setOcrResult(legacyOcr);
      setScanProgress(55);

      // Local printed-code / catalog lookup. No edge function.
      const lookup = await withTimeout(
        runRapidBasicLookup({
          imageUrl: null,
          ocrText,
          title: ocr?.title ?? null,
          setName: null,
          setCode: ocr?.setCode ?? null,
          cardNumber: ocr?.cardNumber ?? null,
          edition: ocr?.edition ?? null,
          game: ocr?.game ?? null,
          gameTypeHint,
          allowGoogleLens: false,
        }),
        LOCAL_LOOKUP_TIMEOUT_MS,
        "Local card lookup",
      );

      const cd = lookup.cardData || {};
      const pricing = lookup.pricing || null;
      setScanProgress(80);

      const identifiedCard: IdentifiedCard = {
        card_name: (cd.card_name || legacyOcr.cardName || "Unknown Card").trim(),
        card_set: cd.card_set ?? legacyOcr.cardSet ?? null,
        card_number: cd.card_number ?? legacyOcr.cardNumber ?? null,
        rarity: cd.rarity ?? null,
        edition: ocr?.edition ?? null,
        game_type: cd.game_type ?? ocr?.game ?? null,
        sport_type: cd.sport_type ?? null,
        year: cd.year ?? null,
        manufacturer: cd.manufacturer ?? null,
        confidence: Math.round(Number(cd.confidence ?? ocr?.confidence ?? 0.5) * 100),
        description: lookup.success ? "" : lookup.error || "",
      };

      const pricingData = pricing
        ? {
            currentPriceRaw: money(pricing.raw ?? pricing.highestSold ?? null),
            currentPricePsa9: money(pricing.psa9 ?? null),
            currentPricePsa10: money(pricing.psa10 ?? pricing.cgc10 ?? null),
            suggestedPrice: money(pricing.raw ?? pricing.highestSold ?? null),
            ebayListingUrl: pricing.url ?? null,
            condition: "ungraded",
          }
        : undefined;

      // MTG heuristics (local).
      const mtgInsights = analyzeMtgIdentification(identifiedCard, legacyOcr.rawText);
      const mtgNotes = buildMtgNotes(mtgInsights);
      if (mtgNotes) {
        identifiedCard.description = [identifiedCard.description, mtgNotes].filter(Boolean).join("\n\n");
        if (!identifiedCard.edition && mtgInsights.alphaBeta.status === "confirmed_alpha") identifiedCard.edition = "Alpha";
        else if (!identifiedCard.edition && mtgInsights.alphaBeta.status === "confirmed_beta") identifiedCard.edition = "Beta";
      }

      const dup = await checkForDuplicate(identifiedCard.card_name, identifiedCard.card_set);

      const anomaly = singleScanDetector.trackIdentification(identifiedCard.card_name);
      if (anomaly.consecutiveCount >= 2) {
        toast.warning("Same card detected twice in a row — check image quality or try a different angle.");
      }

      const alternatives: Alternative[] = [];

      if (scanMode === "SAVE" && dup.isDuplicate && dup.existingCard) {
        setDuplicateCard({
          identifiedCard,
          alternatives,
          imageUrl,
          fallbackData: pricingData,
          isDuplicate: true,
          existingCard: dup.existingCard,
          scanMode,
          ownedCount: dup.ownedCount,
          isInLibrary: true,
        });
        setScanProgress(100);
        return;
      }

      if (
        scanMode === "SAVE" &&
        autoConfirmEnabled &&
        identifiedCard.confidence >= autoConfirmThreshold
      ) {
        try {
          await insertCardDual({
            user_id: userId,
            card_name: identifiedCard.card_name,
            card_set: identifiedCard.card_set,
            card_number: identifiedCard.card_number,
            rarity: identifiedCard.rarity,
            edition: identifiedCard.edition,
            condition: pricingData?.condition || "ungraded",
            sport_type: identifiedCard.sport_type,
            game_type: identifiedCard.game_type,
            notes: identifiedCard.description,
            ocr_confidence: identifiedCard.confidence,
            ocr_raw_text: legacyOcr.rawText,
            current_price_raw: pricingData?.currentPriceRaw,
            current_price_psa9: pricingData?.currentPricePsa9,
            current_price_psa10: pricingData?.currentPricePsa10,
            suggested_price: pricingData?.suggestedPrice,
            ebay_listing_url: pricingData?.ebayListingUrl,
            image_url: imageUrl,
            thumbnail_url: imageUrl,
            last_price_update: new Date().toISOString(),
          } as any);

          addRecentScan({
            id: crypto.randomUUID(),
            card_name: identifiedCard.card_name,
            card_set: identifiedCard.card_set,
            card_number: identifiedCard.card_number ?? null,
            player_name: identifiedCard.sport_type ? identifiedCard.card_name : null,
            image_url: imageUrl,
            price: pricingData?.currentPriceRaw ?? null,
            confidence: identifiedCard.confidence ? identifiedCard.confidence / 100 : null,
          });
          window.dispatchEvent(new CustomEvent("recent-scan-added"));

          toast.success(`Card auto-saved: ${identifiedCard.card_name} (${identifiedCard.confidence}% confidence)`);
          clearSelection();
          setScanProgress(100);
          onScanComplete?.();
          return;
        } catch (error: any) {
          console.error("Auto-save error:", error);
          toast.warning("Auto-save failed, please confirm manually");
        }
      }

      setPendingCard({
        identifiedCard,
        alternatives,
        imageUrl,
        fallbackData: pricingData,
        scanMode,
        ownedCount: dup.ownedCount,
        isInLibrary: dup.isDuplicate,
        existingCard: dup.existingCard,
      });

      setScanProgress(100);
      onScanComplete?.();
    } catch (error: any) {
      console.error("Scan error:", error);
      toast.error(error.message || "Error scanning card");
      setScanProgress(0);
    } finally {
      setIsScanning(false);
      scanLockRef.current = false;
    }
  };

  const clearSelection = useCallback(() => {
    setFile(null);
    setPreview(null);
    setOcrResult(null);
    setScanProgress(0);
    setPendingCard(null);
    setDuplicateCard(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }, []);

  const handleConfirmCard = async (editedCard: IdentifiedCard) => {
    if (!pendingCard) return;
    try {
      await insertCardDual({
        user_id: userId,
        card_name: editedCard.card_name,
        card_set: editedCard.card_set,
        card_number: editedCard.card_number,
        rarity: editedCard.rarity,
        edition: editedCard.edition,
        condition: pendingCard.fallbackData?.condition || "ungraded",
        sport_type: editedCard.sport_type,
        game_type: editedCard.game_type,
        notes: editedCard.description,
        ocr_confidence: editedCard.confidence,
        ocr_raw_text: ocrResult?.rawText,
        current_price_raw: pendingCard.fallbackData?.currentPriceRaw,
        current_price_psa9: pendingCard.fallbackData?.currentPricePsa9,
        current_price_psa10: pendingCard.fallbackData?.currentPricePsa10,
        suggested_price: pendingCard.fallbackData?.suggestedPrice,
        ebay_listing_url: pendingCard.fallbackData?.ebayListingUrl,
        image_url: pendingCard.imageUrl,
        thumbnail_url: pendingCard.imageUrl,
        last_price_update: new Date().toISOString(),
      } as any);

      addRecentScan({
        id: crypto.randomUUID(),
        card_name: editedCard.card_name,
        card_set: editedCard.card_set,
        card_number: editedCard.card_number ?? null,
        player_name: editedCard.sport_type ? editedCard.card_name : null,
        image_url: pendingCard.imageUrl,
        price: pendingCard.fallbackData?.currentPriceRaw ?? null,
        confidence: editedCard.confidence ? editedCard.confidence / 100 : null,
      });
      window.dispatchEvent(new CustomEvent("recent-scan-added"));

      toast.success(
        pendingCard.scanMode === "SCAN_ONLY"
          ? (pendingCard.isInLibrary ? "Added copy to library!" : "Added to library!")
          : "Card saved successfully!"
      );

      clearSelection();
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(error.message || "Error saving card");
    }
  };

  const handleCancelCard = useCallback(() => {
    setPendingCard(null);
    setDuplicateCard(null);
    toast.info("Dismissed");
  }, []);

  const handleConfirmDuplicate = async () => {
    if (!duplicateCard) return;
    try {
      await insertCardDual({
        user_id: userId,
        card_name: duplicateCard.identifiedCard.card_name,
        card_set: duplicateCard.identifiedCard.card_set,
        card_number: duplicateCard.identifiedCard.card_number,
        rarity: duplicateCard.identifiedCard.rarity,
        edition: duplicateCard.identifiedCard.edition,
        condition: duplicateCard.fallbackData?.condition || "ungraded",
        sport_type: duplicateCard.identifiedCard.sport_type,
        game_type: duplicateCard.identifiedCard.game_type,
        notes: duplicateCard.identifiedCard.description,
        ocr_confidence: duplicateCard.identifiedCard.confidence,
        ocr_raw_text: ocrResult?.rawText,
        current_price_raw: duplicateCard.fallbackData?.currentPriceRaw,
        current_price_psa9: duplicateCard.fallbackData?.currentPricePsa9,
        current_price_psa10: duplicateCard.fallbackData?.currentPricePsa10,
        suggested_price: duplicateCard.fallbackData?.suggestedPrice,
        ebay_listing_url: duplicateCard.fallbackData?.ebayListingUrl,
        image_url: duplicateCard.imageUrl,
        thumbnail_url: duplicateCard.imageUrl,
        last_price_update: new Date().toISOString(),
      } as any);

      addRecentScan({
        id: crypto.randomUUID(),
        card_name: duplicateCard.identifiedCard.card_name,
        card_set: duplicateCard.identifiedCard.card_set,
        card_number: duplicateCard.identifiedCard.card_number ?? null,
        player_name: duplicateCard.identifiedCard.sport_type ? duplicateCard.identifiedCard.card_name : null,
        image_url: duplicateCard.imageUrl,
        price: duplicateCard.fallbackData?.currentPriceRaw ?? null,
        confidence: duplicateCard.identifiedCard.confidence ? duplicateCard.identifiedCard.confidence / 100 : null,
      });
      window.dispatchEvent(new CustomEvent("recent-scan-added"));

      toast.success("Duplicate card added to collection!");
      clearSelection();
      onScanComplete?.();
    } catch (error: any) {
      console.error("Save duplicate error:", error);
      toast.error(error.message || "Error saving card");
    }
  };

  const handleSkipDuplicate = useCallback(() => {
    setDuplicateCard(null);
    toast.info("Card skipped - already in collection");
    clearSelection();
  }, [clearSelection]);

  const handleSelectAlternative = useCallback(
    (alternative: Alternative) => {
      if (!pendingCard) return;
      setPendingCard({
        ...pendingCard,
        identifiedCard: {
          ...pendingCard.identifiedCard,
          card_name: alternative.card_name,
          card_set: alternative.card_set,
          confidence: alternative.confidence,
        },
      });
    },
    [pendingCard]
  );

  const setFileWithPreview = useCallback((newFile: File) => {
    setFile(newFile);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(newFile);
    setOcrResult(null);
  }, []);

  return {
    file,
    preview,
    isScanning,
    scanProgress,
    ocrResult,
    pendingCard,
    duplicateCard,
    fileInputRef,
    folderInputRef,

    setFile,
    setPreview,
    setFileWithPreview,
    handleScan,
    clearSelection,
    handleConfirmCard,
    handleCancelCard,
    handleSelectAlternative,
    handleConfirmDuplicate,
    handleSkipDuplicate,
  };
}
