import { useState, useCallback, useRef } from "react";
import { getAllCards, insertCardDual } from "@/lib/localCards";
import { toast } from "sonner";
import { performEmbeddedCardOcr } from "@/lib/vision/embeddedOcr";
import { lookupYugiohByPrintedCode } from "@/lib/yugiohDirectLookup";
import { getScannerSettings, type ScanMode } from "./use-scanner-settings";
import { addRecentScan } from "@/lib/recentScans";
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

function normalize(s: string) {
  return s.toLowerCase().trim();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function money(n: unknown): number | null {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
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

  const checkForDuplicate = async (cardName: string, cardSet: string | null) => {
    if (skipDuplicateCheck || !userId) return { isDuplicate: false, ownedCount: 0 };

    const cards = await getAllCards();
    const normalizedName = normalize(cardName);
    const normalizedSet = normalize(cardSet || "");

    const matches = cards.filter((card: any) => {
      const existingName = normalize(card.card_name || "");
      const existingSet = normalize(card.card_set || "");
      if (existingName !== normalizedName) return false;
      if (!normalizedSet || !existingSet) return true;
      return existingSet === normalizedSet || existingSet.includes(normalizedSet) || normalizedSet.includes(existingSet);
    });

    const first = matches[0] as any;
    return {
      isDuplicate: matches.length > 0,
      ownedCount: matches.length,
      existingCard: first ? {
        id: first.id,
        card_name: first.card_name,
        card_set: first.card_set,
        image_url: first.image_url,
        current_price_raw: first.current_price_raw,
      } : undefined,
    };
  };

  const performOCR = async (imageFile: File): Promise<OCRResult> => {
    setScanProgress(10);
    const embeddedOcr = await performEmbeddedCardOcr(imageFile);
    const setCode = embeddedOcr.setCode || "";
    setScanProgress(35);

    return {
      cardName: embeddedOcr.cardName?.trim() || "Unknown Card",
      cardSet: setCode,
      cardNumber: setCode,
      confidence: embeddedOcr.confidence,
      rawText: embeddedOcr.rawText,
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
      const imageUrl = await fileToDataUrl(file);
      const ocr = await performOCR(file);
      setOcrResult(ocr);
      setScanProgress(55);

      toast.info("Looking up card locally/direct…");
      const lookup = await lookupYugiohByPrintedCode(ocr.cardSet || ocr.cardNumber);
      const cardData = lookup?.cardData;
      const pricing = lookup?.pricing;

      const identifiedCard: IdentifiedCard = cardData?.card_name ? {
        card_name: cardData.card_name,
        card_set: cardData.card_set ?? ocr.cardSet,
        card_number: cardData.card_number ?? ocr.cardNumber,
        rarity: cardData.rarity ?? null,
        edition: null,
        game_type: cardData.game_type ?? "Yu-Gi-Oh",
        sport_type: null,
        year: null,
        manufacturer: cardData.manufacturer ?? "Konami",
        confidence: Math.round(Number(cardData.confidence ?? 0.98) * 100),
        description: lookup?.source ? `Direct lookup: ${lookup.source}` : "Direct local lookup",
      } : {
        card_name: ocr.cardName,
        card_set: ocr.cardSet || null,
        card_number: ocr.cardNumber || null,
        rarity: null,
        edition: null,
        game_type: null,
        sport_type: null,
        year: null,
        manufacturer: null,
        confidence: ocr.confidence,
        description: "No direct card lookup match. Retake closer to the printed set code.",
      };

      setScanProgress(80);

      const rawPrice = money(pricing?.raw ?? pricing?.highestSold ?? null);
      const dup = await checkForDuplicate(identifiedCard.card_name, identifiedCard.card_set);

      const anomaly = singleScanDetector.trackIdentification(identifiedCard.card_name);
      if (anomaly.consecutiveCount >= 2) {
        toast.warning("Same card detected twice in a row — check image quality or try a different angle.");
      }

      const fallbackData = {
        currentPriceRaw: rawPrice,
        currentPricePsa10: money(pricing?.psa10 ?? pricing?.cgc10 ?? null),
        suggestedPrice: rawPrice,
        condition: "ungraded",
      };

      if (scanMode === "SAVE" && dup.isDuplicate && dup.existingCard) {
        setDuplicateCard({
          identifiedCard,
          alternatives: [],
          imageUrl,
          fallbackData,
          isDuplicate: true,
          existingCard: dup.existingCard,
          scanMode,
          ownedCount: dup.ownedCount,
          isInLibrary: true,
        });
        setScanProgress(100);
        return;
      }

      if (scanMode === "SAVE" && autoConfirmEnabled && identifiedCard.confidence >= autoConfirmThreshold) {
        await insertCardDual({
          user_id: userId,
          card_name: identifiedCard.card_name,
          card_set: identifiedCard.card_set,
          card_number: identifiedCard.card_number,
          rarity: identifiedCard.rarity,
          edition: identifiedCard.edition,
          condition: "ungraded",
          sport_type: identifiedCard.sport_type,
          game_type: identifiedCard.game_type,
          notes: identifiedCard.description,
          ocr_confidence: identifiedCard.confidence,
          ocr_raw_text: ocr.rawText,
          current_price_raw: rawPrice,
          current_price_psa10: fallbackData.currentPricePsa10,
          suggested_price: rawPrice,
          image_url: imageUrl,
          thumbnail_url: imageUrl,
          last_price_update: rawPrice ? new Date().toISOString() : null,
        } as any);

        addRecentScan({
          id: crypto.randomUUID(),
          card_name: identifiedCard.card_name,
          card_set: identifiedCard.card_set,
          card_number: identifiedCard.card_number ?? null,
          player_name: null,
          image_url: imageUrl,
          price: rawPrice,
          confidence: identifiedCard.confidence ? identifiedCard.confidence / 100 : null,
        });
        window.dispatchEvent(new CustomEvent("recent-scan-added"));
        toast.success(`Card saved locally: ${identifiedCard.card_name}`);
        clearSelection();
        setScanProgress(100);
        onScanComplete?.();
        return;
      }

      setPendingCard({
        identifiedCard,
        alternatives: [],
        imageUrl,
        fallbackData,
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
        current_price_psa10: pendingCard.fallbackData?.currentPricePsa10,
        suggested_price: pendingCard.fallbackData?.suggestedPrice,
        image_url: pendingCard.imageUrl,
        thumbnail_url: pendingCard.imageUrl,
        last_price_update: new Date().toISOString(),
      } as any);

      addRecentScan({
        id: crypto.randomUUID(),
        card_name: editedCard.card_name,
        card_set: editedCard.card_set,
        card_number: editedCard.card_number ?? null,
        player_name: null,
        image_url: pendingCard.imageUrl,
        price: pendingCard.fallbackData?.currentPriceRaw ?? null,
        confidence: editedCard.confidence ? editedCard.confidence / 100 : null,
      });
      window.dispatchEvent(new CustomEvent("recent-scan-added"));
      toast.success("Card saved locally");
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
    await handleConfirmCard(duplicateCard.identifiedCard);
    setDuplicateCard(null);
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
