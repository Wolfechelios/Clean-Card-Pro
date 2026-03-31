import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertCardDual } from "@/lib/localCards";
import { toast } from "sonner";
import { analyzeCardFull } from "@/lib/analyzeCardFull";
import { withRetry } from "@/lib/retry";
import { getScannerSettings, type ScanMode } from "./use-scanner-settings";
import { addRecentScan } from "@/lib/recentScans";
import { checkGpuServerAvailable } from "@/lib/gpuOffload/gpuAvailability";
import { gpuIdentifyByImageUrl, gpuOcrByImageUrl } from "@/lib/gpuOffload/gpuHttpClient";
import { singleScanDetector } from "@/lib/scanAnomalyDetector";

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

  // NEW: scan workspace metadata
  scanMode?: ScanMode;
  ownedCount?: number; // how many copies user has already
  isInLibrary?: boolean;
  existingCard?: {
    id: string;
    card_name: string;
    card_set: string | null;
    image_url: string;
    current_price_raw: number | null;
  };

  // existing duplicate structure (kept)
  isDuplicate?: boolean;
}

interface UseCardScannerOptions {
  userId: string;
  onScanComplete?: () => void;
  skipDuplicateCheck?: boolean;
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

  const normalize = (s: string) => s.toLowerCase().trim();

  // Check if card already exists in collection
  const checkForDuplicate = async (
    cardName: string,
    cardSet: string | null
  ): Promise<{
    isDuplicate: boolean;
    ownedCount: number;
    existingCard?: {
      id: string;
      card_name: string;
      card_set: string | null;
      image_url: string;
      current_price_raw: number | null;
    };
  }> => {
    if (skipDuplicateCheck || !userId) {
      return { isDuplicate: false, ownedCount: 0 };
    }

    try {
      const normalizedName = normalize(cardName);
      const normalizedSet = normalize(cardSet || "");

      const { data: existingCards, error } = await supabase
        .from("cards")
        .select("id, card_name, card_set, image_url, current_price_raw")
        .eq("user_id", userId)
        .ilike("card_name", `%${normalizedName.split(" ").slice(0, 3).join("%")}%`)
        .limit(25);

      if (error || !existingCards || existingCards.length === 0) {
        return { isDuplicate: false, ownedCount: 0 };
      }

      // Find exact-ish match
      const match = existingCards.find((card) => {
        const existingName = normalize(card.card_name);
        const existingSet = normalize(card.card_set || "");

        if (existingName !== normalizedName) return false;

        // If sets match or one is empty, count as same printing-ish
        if (!normalizedSet || !existingSet) return true;
        if (existingSet === normalizedSet) return true;
        if (existingSet.includes(normalizedSet) || normalizedSet.includes(existingSet)) return true;

        return false;
      });

      // Owned count (best-effort, cheap count using exact-ish filters)
      // NOTE: Supabase "count" requires select with head:true
      let ownedCount = 0;
      try {
        let q = supabase
          .from("cards")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .ilike("card_name", normalizedName);

        if (cardSet && cardSet.trim().length > 0) {
          q = q.ilike("card_set", cardSet.trim());
        }

        const { count } = await q;
        ownedCount = count || 0;
      } catch {
        ownedCount = match ? 1 : 0;
      }

      if (match) {
        return { isDuplicate: true, ownedCount: Math.max(ownedCount, 1), existingCard: match };
      }

      return { isDuplicate: false, ownedCount: 0 };
    } catch (err) {
      console.error("Duplicate check error:", err);
      return { isDuplicate: false, ownedCount: 0 };
    }
  };

  const performOCR = async (imageUrl: string): Promise<OCRResult> => {
    setScanProgress(10);
    const scanner = getScannerSettings() as any;
    const gpuEnabled = scanner.gpuOffloadEnabled === true;
    let ocrText = "";

    // Prefer local accelerator OCR if available
    if (gpuEnabled && (await checkGpuServerAvailable()).ok) {
      try {
        const local = await gpuOcrByImageUrl(imageUrl);
        if (local?.success && local.text?.trim()) {
          ocrText = local.text;
        }
      } catch {
        // fallback below
      }
    }

    // Cloud fallback
    if (!ocrText) {
      const analysis = await analyzeCardFull(imageUrl);
      ocrText = analysis.vision.ocr_text;
    }

    setScanProgress(80);
    const lines = ocrText.split("\n").filter((line) => line.trim());
    const cardName = lines[0] || "Unknown Card";
    const cardSet = lines.find((line) => line.toLowerCase().includes("set")) || "";
    const cardNumber = lines.find((line) => /\d+\/\d+/.test(line)) || "";

    return {
      cardName: cardName.trim(),
      cardSet: cardSet.replace(/set/i, "").trim(),
      cardNumber: cardNumber.trim(),
      confidence: 95,
      rawText: ocrText,
    };
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

    const { scanMode, autoConfirmEnabled, autoConfirmThreshold } = getScannerSettings();

    try {
      const fileExt = file.name.split(".").pop();
      const cardId = crypto.randomUUID();
      const fileName = `cards/${cardId}.${fileExt}`;

      setScanProgress(20);

      await withRetry(async () => {
        const { error: uploadError } = await supabase.storage
          .from("card-images")
          .upload(fileName, file, { upsert: false });
        if (uploadError) throw uploadError;
      });

      const { data: publicUrlData } = supabase.storage
        .from("card-images")
        .getPublicUrl(fileName);
      const imageUrl = publicUrlData.publicUrl;

      setScanProgress(40);

      const ocr = await performOCR(imageUrl);
      setOcrResult(ocr);
      setScanProgress(60);

      toast.info("Identifying card...");

      let enhancedData: any;
      let alternatives: Alternative[] = [];
      let gpuPricing: any = null;

      // Priority: Local accelerator (Mac/PC) if enabled
      const scanner = getScannerSettings() as any;
      const gpuEnabled = scanner.gpuOffloadEnabled === true;
      if (gpuEnabled && (await checkGpuServerAvailable()).ok) {
        try {
          const gpu = await gpuIdentifyByImageUrl(imageUrl, { wantPricing: true });
          if (gpu?.success) {
            enhancedData = {
              card_name: gpu.cardData.card_name,
              card_set: gpu.cardData.card_set,
              card_number: gpu.cardData.card_number,
              rarity: gpu.cardData.rarity,
              edition: gpu.cardData.edition,
              game_type: gpu.cardData.game_type,
              sport_type: gpu.cardData.sport_type,
              year: gpu.cardData.year,
              manufacturer: gpu.cardData.manufacturer,
              confidence: gpu.cardData.confidence,
              description: gpu.cardData.description ?? "",
            };
            // If GPU server returned pricing, map to existing pricingData shape
            if (gpu.pricing) gpuPricing = gpu.pricing;
            toast.success(`Local accelerator: ${enhancedData.card_name}`);
          }
        } catch (e) {
          console.warn("GPU identify failed, falling back:", e);
        }
      }

      try {
        const enhancedResult = await withRetry(
          async () => {
            const { data, error } = await supabase.functions.invoke("enhanced-card-identify", {
              body: { imageUrl, ocrText: ocr.rawText },
            });
            if (error) throw new Error(error.message);
            return data;
          },
          { retries: 3, baseMs: 600, maxMs: 5000 }
        );

        if (enhancedResult?.success) {
          const cardData = enhancedResult.cardData;
          if (cardData.primary) {
            enhancedData = cardData.primary;
            alternatives = cardData.alternatives || [];
          } else {
            enhancedData = cardData;
          }
          toast.success(`Card identified: ${enhancedData.card_name}`);
        }
      } catch (error) {
        console.error("Enhanced identification error:", error);
        toast.warning("Using fallback identification...");
      }

      setScanProgress(70);

      let pricingData: any;
      try {
        // If GPU pricing was populated, use it first.
        if (gpuPricing) {
          pricingData = {
            currentPriceRaw: gpuPricing.currentPriceRaw ?? null,
            currentPricePsa9: gpuPricing.currentPricePsa9 ?? null,
            currentPricePsa10: gpuPricing.currentPricePsa10 ?? null,
            suggestedPrice: gpuPricing.suggestedPrice ?? null,
            ebayListingUrl: gpuPricing.ebayListingUrl ?? null,
          };
        }

        if (pricingData) {
          // done
        } else {
        const cardIdentification = await withRetry(
          async () => {
            const { data, error } = await supabase.functions.invoke("identify-card", {
              body: { imageUrl, ocrText: ocr.rawText },
            });
            if (error) throw new Error(error.message);
            return data;
          },
          { retries: 3, baseMs: 600, maxMs: 7000 }
        );

        if (cardIdentification) pricingData = cardIdentification;
        }
      } catch (error) {
        console.error("Pricing fetch error:", error);
        toast.warning("Could not fetch pricing data");
      }

      setScanProgress(90);

      const identifiedCard: IdentifiedCard = enhancedData || {
        card_name: pricingData?.cardName || ocr.cardName,
        card_set: pricingData?.cardSet || ocr.cardSet,
        card_number: pricingData?.cardNumber || ocr.cardNumber,
        rarity: pricingData?.rarity || null,
        edition: pricingData?.edition || null,
        game_type: pricingData?.gameType || null,
        sport_type: pricingData?.sportType || null,
        year: pricingData?.year || null,
        manufacturer: pricingData?.manufacturer || null,
        confidence: enhancedData?.confidence || pricingData?.confidence || ocr.confidence,
        description: pricingData?.notes || "",
      };

      const dup = await checkForDuplicate(identifiedCard.card_name, identifiedCard.card_set);

      // SAVE MODE: keep existing duplicate dialog behavior
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

      // SAVE MODE: keep existing auto-confirm behavior
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
            ocr_raw_text: ocr.rawText,
            current_price_raw: pricingData?.currentPriceRaw,
            current_price_psa9: pricingData?.currentPricePsa9,
            current_price_psa10: pricingData?.currentPricePsa10,
            suggested_price: pricingData?.suggestedPrice,
            ebay_listing_url: pricingData?.ebayListingUrl,
            image_url: imageUrl,
            thumbnail_url: imageUrl,
            last_price_update: new Date().toISOString(),
          });

          // Track in recent scans
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

          toast.success(
            `Card auto-saved: ${identifiedCard.card_name} (${identifiedCard.confidence}% confidence)`
          );
          clearSelection();
          setScanProgress(100);
          onScanComplete?.();
          return;
        } catch (error: any) {
          console.error("Auto-save error:", error);
          toast.warning("Auto-save failed, please confirm manually");
        }
      }

      // Show editor (both modes)
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
      });

      // Track in recent scans
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

      // Scan-only mode: "Add" is explicit user action, so we still save here—just don't auto-save.
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

  // Handle confirming a duplicate card (add anyway) - KEEP existing
  const handleConfirmDuplicate = async () => {
    if (!duplicateCard) return;

    try {
      const { error: dbError } = await supabase.from("cards").insert({
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
      });

      if (dbError) throw dbError;

      // Track in recent scans
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

  // Handle skipping a duplicate card - KEEP existing
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
    // State
    file,
    preview,
    isScanning,
    scanProgress,
    ocrResult,
    pendingCard,
    duplicateCard,
    fileInputRef,
    folderInputRef,

    // Actions
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
