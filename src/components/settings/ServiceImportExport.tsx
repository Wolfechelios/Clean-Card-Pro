import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Upload, FileSpreadsheet, AlertCircle, ExternalLink, ImageIcon, Loader2, Check, X, Edit2, Search, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { checkImportAnomaly } from "@/lib/scanAnomalyDetector";
import * as ExcelJS from "exceljs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ServiceImportExportProps {
  userId: string | null;
  totalCards: number;
  onComplete: () => void;
}

type ExportFormat = "sportscardpro" | "pricecharting" | "generic";
type ImportFormat = "sportscardpro" | "pricecharting" | "generic" | "collx";

interface CardToVerify {
  id: string;
  card_name: string;
  card_set: string | null;
  image_url: string;
  confidence: number;
  suggested_name?: string;
  suggested_set?: string;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ServiceImportExport({ userId, totalCards, onComplete }: ServiceImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importFormat, setImportFormat] = useState<ImportFormat>("generic");
  const [lookupImages, setLookupImages] = useState(true);
  const [imageLookupProgress, setImageLookupProgress] = useState<{ current: number; total: number } | null>(null);
  const [cardsToVerify, setCardsToVerify] = useState<CardToVerify[]>([]);
  const [activeSection, setActiveSection] = useState<"import" | "verify">("import");
  const [scanningLowConfidence, setScanningLowConfidence] = useState(false);
  const [lowConfidenceCount, setLowConfidenceCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const fetchLowConfidenceCount = async () => {
      if (!userId) return;
      const { count } = await supabase
        .from("cards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .or("ocr_confidence.is.null,ocr_confidence.lt.80");
      setLowConfidenceCount(count || 0);
    };
    fetchLowConfidenceCount();
  }, [userId, cardsToVerify.length]);

  const fetchAllCards = async () => {
    if (!userId) return [];
    const allCards: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId)
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      if (data && data.length > 0) {
        allCards.push(...data);
        page++;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }
    return allCards;
  };

  const exportToSportsCardPro = async () => {
    if (!userId) return;
    try {
      const cards = await fetchAllCards();
      if (!cards || cards.length === 0) { toast.error("No cards to export"); return; }
      const exportData = cards.map(card => ({
        "Player/Card Name": card.card_name,
        "Year": card.card_set?.match(/\d{4}/)?.[0] || "",
        "Set": card.card_set || "",
        "Card Number": card.card_number || "",
        "Variation": card.edition || "",
        "Grade": card.condition === "ungraded" ? "" : card.condition,
        "Quantity": 1,
        "Sport": card.sport_type || "",
        "Notes": card.notes || "",
      }));
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Cards");
      const headers = Object.keys(exportData[0]);
      ws.addRow(headers);
      exportData.forEach(row => ws.addRow(headers.map(h => row[h as keyof typeof row])));
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      downloadBlob(`sportscardpro-export-${new Date().toISOString().split('T')[0]}.csv`, blob);
      toast.success(`Exported ${cards.length} cards for SportsCardPro`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export cards");
    }
  };

  const exportToPriceCharting = async () => {
    if (!userId) return;
    try {
      const cards = await fetchAllCards();
      if (!cards || cards.length === 0) { toast.error("No cards to export"); return; }
      const exportData = cards.map(card => ({
        "product-name": card.card_name,
        "console-name": card.game_type || card.sport_type || "Trading Cards",
        "upc": card.card_number || "",
        "condition": mapConditionToPriceCharting(card.condition),
        "quantity": 1,
        "notes": card.notes || "",
        "box": "No",
        "manual": "No",
      }));
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Collection");
      const headers = Object.keys(exportData[0]);
      ws.addRow(headers);
      exportData.forEach(row => ws.addRow(headers.map(h => row[h as keyof typeof row])));
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      downloadBlob(`pricecharting-export-${new Date().toISOString().split('T')[0]}.csv`, blob);
      toast.success(`Exported ${cards.length} cards for PriceCharting`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export cards");
    }
  };

  const exportToGeneric = async () => {
    if (!userId) return;
    try {
      const cards = await fetchAllCards();
      if (!cards || cards.length === 0) { toast.error("No cards to export"); return; }
      const exportData = cards.map(card => ({
        "Card Name": card.card_name,
        "Set": card.card_set || "",
        "Card Number": card.card_number || "",
        "Rarity": card.rarity || "",
        "Edition": card.edition || "",
        "Condition": card.condition || "ungraded",
        "Game Type": card.game_type || "",
        "Sport Type": card.sport_type || "",
        "Price (Raw)": card.current_price_raw || 0,
        "Price (PSA 9)": card.current_price_psa9 || 0,
        "Price (PSA 10)": card.current_price_psa10 || 0,
        "Collection": (card.card_set || card.collection_name || ""),
        "Notes": card.notes || "",
        "Image URL": card.image_url || "",
        "Added Date": new Date(card.created_at).toLocaleDateString(),
      }));
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Cards");
      const headers = Object.keys(exportData[0]);
      ws.addRow(headers);
      exportData.forEach(row => ws.addRow(headers.map(h => row[h as keyof typeof row])));
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      downloadBlob(`card-collection-${new Date().toISOString().split('T')[0]}.xlsx`, blob);
      toast.success(`Exported ${cards.length} cards`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export cards");
    }
  };

  const mapConditionToPriceCharting = (condition: string | null): string => {
    const conditionMap: Record<string, string> = {
      "mint": "Mint", "near-mint": "Near Mint", "excellent": "Good", "good": "Good",
      "fair": "Fair", "poor": "Poor", "ungraded": "Loose", "PSA 10": "Graded", "PSA 9": "Graded", "PSA 8": "Graded",
    };
    return conditionMap[condition || "ungraded"] || "Loose";
  };

  const mapConditionFromPriceCharting = (condition: string): string => {
    const conditionMap: Record<string, string> = {
      "Mint": "mint", "Near Mint": "near-mint", "Good": "good", "Fair": "fair",
      "Poor": "poor", "Loose": "ungraded", "Graded": "ungraded", "Complete": "ungraded",
    };
    return conditionMap[condition] || "ungraded";
  };

  const lookupCardImage = async (cardId: string, cardName: string, cardSet: string | null, gameType: string | null): Promise<string | null> => {
    try {
      const searchQuery = [cardName, cardSet, gameType].filter(Boolean).join(" ");
      const { data, error } = await supabase.functions.invoke("generate-card-image-url", {
        body: { cardName, cardSet, gameType, searchQuery }
      });
      if (error || !data?.imageUrl) return "";
      return data.imageUrl;
    } catch (err) {
      console.error("Image lookup error:", err);
      return null;
    }
  };

  const processImageLookups = async (cardIds: string[]) => {
    if (!lookupImages || cardIds.length === 0) return;
    setImageLookupProgress({ current: 0, total: cardIds.length });
    const { data: cards, error } = await supabase
      .from("cards")
      .select("id, card_name, card_set, game_type, sport_type, image_url")
      .in("id", cardIds);
    if (error || !cards) { console.error("Failed to fetch imported cards for image lookup"); return; }
    const batchSize = 3;
    let processed = 0;
    const lowConfidenceCards: CardToVerify[] = [];
    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize);
      await Promise.all(batch.map(async (card) => {
        const imageUrl = await lookupCardImage(card.id, card.card_name, card.card_set, card.game_type || card.sport_type);
        if (imageUrl) {
          try {
            const { data: identifyData } = await supabase.functions.invoke("enhanced-card-identify", { body: { imageUrl } });
            const confidence = identifyData?.cardData?.confidence ?? 100;
            const suggestedName = identifyData?.cardData?.card_name;
            const suggestedSet = identifyData?.cardData?.card_set;
            await supabase.from("cards").update({ image_url: imageUrl, thumbnail_url: imageUrl, ocr_confidence: confidence }).eq("id", card.id);
            if (confidence < 90) {
              lowConfidenceCards.push({ id: card.id, card_name: card.card_name, card_set: card.card_set, image_url: imageUrl, confidence, suggested_name: suggestedName, suggested_set: suggestedSet });
            }
          } catch (err) {
            console.error("Card identification error:", err);
            await supabase.from("cards").update({ image_url: imageUrl, thumbnail_url: imageUrl }).eq("id", card.id);
          }
        }
      }));
      processed += batch.length;
      setImageLookupProgress({ current: processed, total: cardIds.length });
    }
    setImageLookupProgress(null);
    if (lowConfidenceCards.length > 0) {
      setCardsToVerify(lowConfidenceCards);
      setActiveSection("verify");
      toast.info(`${lowConfidenceCards.length} cards need verification (confidence < 90%)`);
    } else {
      toast.success(`Updated images for ${processed} cards`);
    }
  };

  const handleVerifyCard = async (cardId: string, newName: string, newSet: string | null) => {
    const { error } = await supabase.from("cards").update({ card_name: newName, card_set: newSet, ocr_confidence: 100 }).eq("id", cardId);
    if (error) { toast.error("Failed to update card"); return; }
    setCardsToVerify(prev => prev.filter(c => c.id !== cardId));
    toast.success("Card verified");
  };

  const handleDismissCard = (cardId: string) => { setCardsToVerify(prev => prev.filter(c => c.id !== cardId)); };

  const handleVerifyAll = async () => {
    const updates = cardsToVerify.map(card => supabase.from("cards").update({ ocr_confidence: 100 }).eq("id", card.id));
    await Promise.all(updates);
    setCardsToVerify([]);
    setActiveSection("import");
    toast.success("All cards verified");
  };

  const handleScanLowConfidenceCards = async () => {
    if (!userId) return;
    try {
      setScanningLowConfidence(true);
      const { data: lowConfCards, error } = await supabase.from("cards").select("id, card_name, card_set, image_url, ocr_confidence, game_type, sport_type").eq("user_id", userId).or("ocr_confidence.is.null,ocr_confidence.lt.80").limit(50);
      if (error) throw error;
      if (!lowConfCards || lowConfCards.length === 0) { toast.info("No cards with low confidence found"); setScanningLowConfidence(false); return; }
      setImageLookupProgress({ current: 0, total: lowConfCards.length });
      const verificationQueue: CardToVerify[] = [];
      for (let i = 0; i < lowConfCards.length; i++) {
        const card = lowConfCards[i];
        try {
          const { data: refData } = await supabase.functions.invoke("generate-card-image-url", { body: { cardName: card.card_name, cardSet: card.card_set, gameType: card.game_type || card.sport_type } });
          let suggestedName = card.card_name;
          let suggestedSet = card.card_set;
          let confidence = card.ocr_confidence || 0;
          if (refData?.imageUrl && !refData.imageUrl.includes("placehold.co")) {
            try {
              const { data: identifyData } = await supabase.functions.invoke("enhanced-card-identify", { body: { imageUrl: card.image_url } });
              if (identifyData?.cardData) {
                suggestedName = identifyData.cardData.primary?.card_name || identifyData.cardData.card_name || card.card_name;
                suggestedSet = identifyData.cardData.primary?.card_set || identifyData.cardData.card_set || card.card_set;
                confidence = (identifyData.cardData.primary?.confidence || identifyData.cardData.confidence || 0) * 100;
              }
            } catch (err) { console.error("OCR error:", err); }
          }
          verificationQueue.push({ id: card.id, card_name: card.card_name, card_set: card.card_set, image_url: card.image_url, confidence, suggested_name: suggestedName !== card.card_name ? suggestedName : undefined, suggested_set: suggestedSet !== card.card_set ? suggestedSet : undefined });
        } catch (err) { console.error("Error processing card:", err); }
        setImageLookupProgress({ current: i + 1, total: lowConfCards.length });
      }
      setImageLookupProgress(null);
      setScanningLowConfidence(false);
      if (verificationQueue.length > 0) { setCardsToVerify(verificationQueue); setActiveSection("verify"); toast.info(`${verificationQueue.length} cards ready for verification`); }
      else { toast.success("All cards verified successfully"); }
    } catch (error) {
      console.error("Error scanning low confidence cards:", error);
      toast.error("Failed to scan cards");
      setScanningLowConfidence(false);
      setImageLookupProgress(null);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userId) return;
    setImporting(true);
    setImportProgress(0);
    try {
      const buf = await file.arrayBuffer();
      const ext = file.name.split(".").pop()?.toLowerCase();
      let jsonData: any[] = [];
      if (ext === "csv") {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length > 0) {
          const parseLine = (line: string) => {
            const out: string[] = []; let cur = ""; let inQ = false;
            for (let i = 0; i < line.length; i++) {
              const ch = line[i];
              if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
              else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
              else { cur += ch; }
            }
            out.push(cur);
            return out.map(v => v.trim());
          };
          const headers = parseLine(lines[0]).map(h => h.replace(/^"(.*)"$/, "$1").trim());
          for (let i = 1; i < lines.length; i++) {
            const cols = parseLine(lines[i]);
            if (cols.every(c => c === "")) continue;
            const obj: any = {};
            headers.forEach((h, idx) => (obj[h] = cols[idx] ?? ""));
            jsonData.push(obj);
          }
        }
      } else {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        if (ws) {
          const headerRow = ws.getRow(1).values as any[];
          const headers = headerRow.slice(1).map(v => String(v ?? "").trim());
          ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const values = row.values as any[];
            const obj: any = {};
            let hasAny = false;
            for (let i = 0; i < headers.length; i++) {
              const val = values[i + 1];
              const norm = val instanceof Date ? val.toISOString() : (val ?? "");
              if (String(norm).trim() !== "") hasAny = true;
              obj[headers[i]] = norm;
            }
            if (hasAny) jsonData.push(obj);
          });
        }
      }

      if (jsonData.length === 0) { toast.error("No data found in file"); setImporting(false); return; }

      // ─── Pre-insert anomaly check ───
      const parsedCards = jsonData.map((row: any) => parseRowByFormat(row, importFormat, userId));
      const parsedNames = parsedCards.map((c: any) => c.card_name || "Unknown Card");
      const anomaly = checkImportAnomaly(parsedNames);
      if (anomaly.isCritical) {
        toast.error(anomaly.message);
        setImporting(false);
        return;
      }
      if (anomaly.hasAnomaly) {
        const proceed = window.confirm(`Warning: ${anomaly.message}\n\nContinue with import anyway?`);
        if (!proceed) {
          toast.info("Import cancelled");
          setImporting(false);
          return;
        }
      }
      const columnNames = Object.keys(jsonData[0]);
      console.log("CSV Columns found:", columnNames);

      const batchSize = 10;
      let imported = 0;
      const importedCardIds: string[] = [];
      for (let i = 0; i < jsonData.length; i += batchSize) {
        const batch = jsonData.slice(i, i + batchSize);
        const cardsToInsert = batch.map((row: any) => parseRowByFormat(row, importFormat, userId));
        const { data: insertedCards, error } = await supabase.from("cards").insert(cardsToInsert).select("id");
        if (error) { console.error("Batch import error:", error); }
        else { imported += batch.length; if (insertedCards) { importedCardIds.push(...insertedCards.map(c => c.id)); } }
        setImportProgress(Math.round(((i + batch.length) / jsonData.length) * 100));
      }
      toast.success(`Successfully imported ${imported} cards`);
      setImporting(false);
      if (lookupImages && importedCardIds.length > 0) { await processImageLookups(importedCardIds); }
      onComplete();
    } catch (error) {
      console.error("File read error:", error);
      toast.error("Failed to read file");
      setImporting(false);
    } finally {
      setImportProgress(0);
      if (fileInputRef.current) { fileInputRef.current.value = ""; }
    }
  };

  const parseRowByFormat = (row: any, format: ImportFormat, userId: string) => {
    switch (format) {
      case "sportscardpro": return { user_id: userId, card_name: row["Player/Card Name"] || row["Player"] || row["Card Name"] || "Unknown Card", card_set: row["Set"] || row["Brand"] || null, card_number: row["Card Number"] || row["#"] || null, rarity: row["Variation"] || null, edition: row["Variation"] || null, condition: row["Grade"] ? `PSA ${row["Grade"]}` : "ungraded", sport_type: row["Sport"] || null, notes: row["Notes"] || null, image_url: "" };
      case "pricecharting": return { user_id: userId, card_name: row["product-name"] || row["Product Name"] || "Unknown Card", card_set: null, card_number: row["upc"] || null, rarity: null, condition: mapConditionFromPriceCharting(row["condition"] || "Loose"), game_type: row["console-name"] || row["Console"] || null, notes: row["notes"] || row["Notes"] || null, image_url: "" };
      case "collx": {
        // Explicit Collx header mappings first, fuzzy as fallback
        const COLLX_NAME_HEADERS = ["Player Name", "Card Name", "Title", "Name", "Card"];
        const COLLX_SET_HEADERS = ["Set Name", "Set", "Product", "Brand", "Year"];
        const findColumn = (row: any, ...keywords: string[]): string | null => { const keys = Object.keys(row); for (const keyword of keywords) { const found = keys.find(k => k.toLowerCase().includes(keyword.toLowerCase())); if (found && row[found]) return row[found]; } return null; };
        const findExplicit = (row: any, explicitHeaders: string[]): string | null => {
          const keys = Object.keys(row);
          for (const header of explicitHeaders) {
            const found = keys.find(k => k === header);
            if (found && row[found]) return row[found];
          }
          return null;
        };
        const cardName = findExplicit(row, COLLX_NAME_HEADERS) || findColumn(row, "player", "name", "title", "card") || "Unknown Card";
        const cardSet = findExplicit(row, COLLX_SET_HEADERS) || findColumn(row, "set", "product", "brand", "year") || null;
        const cardNumber = findColumn(row, "number", "card #", "#") || row["Card Number"] || row["Card #"] || null;
        const parallel = findColumn(row, "parallel", "variation", "variant", "rarity") || row["Parallel"] || null;
        const condition = findColumn(row, "condition", "grade") || row["Condition"] || "";
        const value = findColumn(row, "value", "price", "worth") || row["Value"] || "0";
        const sport = findColumn(row, "sport", "category", "type") || row["Sport"] || null;
        const imageUrl = findColumn(row, "image", "photo", "picture", "url") || row["Image URL"] || null;
        const notes = findColumn(row, "notes", "description") || row["Notes"] || null;
        return { user_id: userId, card_name: cardName, card_set: cardSet, card_number: cardNumber, rarity: parallel, edition: parallel, condition: mapCollxCondition(condition), sport_type: sport, game_type: sport === "Pokemon" || sport === "Magic" || sport === "Yu-Gi-Oh" || sport === "TCG" ? sport : null, current_price_raw: parseFloat(String(value).replace(/[$,]/g, "")) || null, collection_name: null, notes: notes, image_url: imageUrl || "" };
      }
      default: return { user_id: userId, card_name: row["Card Name"] || row["card_name"] || row["Name"] || "Unknown Card", card_set: (row["Set"] || row["card_set"] || row["Collection"] || null), card_number: row["Card Number"] || row["card_number"] || null, rarity: row["Rarity"] || row["rarity"] || null, edition: row["Edition"] || row["edition"] || null, condition: row["Condition"] || row["condition"] || "ungraded", game_type: row["Game Type"] || row["game_type"] || null, sport_type: row["Sport Type"] || row["sport_type"] || null, current_price_raw: parseFloat(row["Price (Raw)"] || row["Price"] || row["current_price_raw"] || 0) || null, current_price_psa9: parseFloat(row["Price (PSA 9)"] || row["current_price_psa9"] || 0) || null, current_price_psa10: parseFloat(row["Price (PSA 10)"] || row["current_price_psa10"] || 0) || null, collection_name: (row["Set"] || row["card_set"] || row["Collection"] || null), notes: row["Notes"] || row["notes"] || null, image_url: row["Image URL"] || row["image_url"] || "" };
    }
  };

  const mapCollxCondition = (condition: string): string => {
    const cl = condition.toLowerCase();
    if (cl.includes("psa") || cl.includes("bgs") || cl.includes("cgc")) return condition;
    const map: Record<string, string> = { "mint": "mint", "near mint": "near-mint", "nm": "near-mint", "excellent": "excellent", "good": "good", "fair": "fair", "poor": "poor", "raw": "ungraded", "ungraded": "ungraded", "": "ungraded" };
    return map[cl] || "ungraded";
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />Import / Export</span>
          {cardsToVerify.length > 0 && (<Badge variant="destructive" className="text-xs">{cardsToVerify.length} needs verification</Badge>)}
        </CardTitle>
        <CardDescription>Import from or export to external services</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {cardsToVerify.length > 0 && (
          <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as "import" | "verify")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="import">Import / Export</TabsTrigger>
              <TabsTrigger value="verify" className="relative">Verify Cards<Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{cardsToVerify.length}</Badge></TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {activeSection === "verify" && cardsToVerify.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">These cards had low OCR confidence (&lt;90%). Please verify the card details.</p>
              <Button variant="outline" size="sm" onClick={handleVerifyAll}><Check className="h-3 w-3 mr-1" />Accept All</Button>
            </div>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {cardsToVerify.map((card) => (<VerificationCard key={card.id} card={card} onVerify={handleVerifyCard} onDismiss={handleDismissCard} />))}
              </div>
            </ScrollArea>
          </div>
        )}

        {(activeSection === "import" || cardsToVerify.length === 0) && (
          <>
            {importing && (<div className="space-y-2"><div className="flex items-center justify-between text-sm"><span>Importing cards...</span><span>{importProgress}%</span></div><Progress value={importProgress} /></div>)}
            {imageLookupProgress && (<div className="space-y-2"><div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Looking up & verifying card images...</span><span>{imageLookupProgress.current}/{imageLookupProgress.total}</span></div><Progress value={(imageLookupProgress.current / imageLookupProgress.total) * 100} /></div>)}

            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Export Collection</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Button variant="outline" onClick={exportToSportsCardPro} disabled={totalCards === 0} className="flex-col h-auto py-3"><Download className="h-4 w-4 mb-1" /><span className="text-xs">SportsCardPro</span><span className="text-[10px] text-muted-foreground">(.csv)</span></Button>
                <Button variant="outline" onClick={exportToPriceCharting} disabled={totalCards === 0} className="flex-col h-auto py-3"><Download className="h-4 w-4 mb-1" /><span className="text-xs">PriceCharting</span><span className="text-[10px] text-muted-foreground">(.csv)</span></Button>
                <Button variant="outline" onClick={exportToGeneric} disabled={totalCards === 0} className="flex-col h-auto py-3"><Download className="h-4 w-4 mb-1" /><span className="text-xs">Full Export</span><span className="text-[10px] text-muted-foreground">(.xlsx)</span></Button>
              </div>
              {totalCards === 0 && (<p className="text-xs text-muted-foreground">No cards to export</p>)}
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Import Collection</h3>
              <Alert><AlertCircle className="h-4 w-4" /><AlertDescription className="text-xs">Select the format that matches your file source, then upload your CSV or Excel file.</AlertDescription></Alert>
              <Tabs value={importFormat} onValueChange={(v) => setImportFormat(v as ImportFormat)}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="generic" className="text-xs">Generic</TabsTrigger>
                  <TabsTrigger value="collx" className="text-xs">Collx</TabsTrigger>
                  <TabsTrigger value="sportscardpro" className="text-xs">SportsCardPro</TabsTrigger>
                  <TabsTrigger value="pricecharting" className="text-xs">PriceCharting</TabsTrigger>
                </TabsList>
                <TabsContent value="generic" className="space-y-3 mt-4"><p className="text-xs text-muted-foreground">Standard format with columns: Card Name, Set, Card Number, Rarity, Condition, Price, etc.</p></TabsContent>
                <TabsContent value="collx" className="space-y-3 mt-4"><p className="text-xs text-muted-foreground">Import from Collx exports.</p><a href="https://www.collx.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Visit Collx <ExternalLink className="h-3 w-3" /></a></TabsContent>
                <TabsContent value="sportscardpro" className="space-y-3 mt-4"><p className="text-xs text-muted-foreground">Import from SportsCardPro exports.</p><a href="https://www.sportscardpro.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Visit SportsCardPro <ExternalLink className="h-3 w-3" /></a></TabsContent>
                <TabsContent value="pricecharting" className="space-y-3 mt-4"><p className="text-xs text-muted-foreground">Import from PriceCharting exports.</p><a href="https://www.pricecharting.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Visit PriceCharting <ExternalLink className="h-3 w-3" /></a></TabsContent>
              </Tabs>
              <div className="flex items-center space-x-2">
                <Checkbox id="lookup-images" checked={lookupImages} onCheckedChange={(checked) => setLookupImages(checked === true)} disabled={importing || !!imageLookupProgress} />
                <Label htmlFor="lookup-images" className="text-sm cursor-pointer"><span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" />Look up card images after import (runs OCR verification)</span></Label>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" disabled={importing || !!imageLookupProgress} />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing || !!imageLookupProgress || !userId} className="w-full"><Upload className="h-4 w-4 mr-2" />Import {importFormat === "generic" ? "CSV/Excel" : importFormat === "collx" ? "Collx" : importFormat === "sportscardpro" ? "SportsCardPro" : "PriceCharting"} File</Button>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Eye className="h-4 w-4" />Verify Existing Cards</h3>
              <p className="text-xs text-muted-foreground">Scan cards with low OCR confidence (&lt;80%) to verify identification.</p>
              {lowConfidenceCount > 0 && (<Alert><Search className="h-4 w-4" /><AlertDescription className="text-xs"><strong>{lowConfidenceCount}</strong> cards have low or missing OCR confidence and may need verification.</AlertDescription></Alert>)}
              <Button variant="outline" onClick={handleScanLowConfidenceCards} disabled={scanningLowConfidence || !!imageLookupProgress || !userId || lowConfidenceCount === 0} className="w-full">
                {scanningLowConfidence ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Scanning Cards...</>) : (<><Search className="h-4 w-4 mr-2" />Verify Low Confidence Cards ({lowConfidenceCount})</>)}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VerificationCard({ card, onVerify, onDismiss }: { card: CardToVerify; onVerify: (id: string, name: string, set: string | null) => void; onDismiss: (id: string) => void; }) {
  const [editing, setEditing] = useState(false);
  const [editedName, setEditedName] = useState(card.card_name);
  const [editedSet, setEditedSet] = useState(card.card_set || "");
  const handleSave = () => { onVerify(card.id, editedName, editedSet || null); setEditing(false); };
  const handleUseSuggestion = () => { if (card.suggested_name) { setEditedName(card.suggested_name); setEditedSet(card.suggested_set || ""); setEditing(true); } };
  return (
    <div className="flex gap-3 p-3 bg-muted/50 rounded-lg border border-border">
      <div className="w-20 h-28 flex-shrink-0 rounded overflow-hidden bg-background"><img src={card.image_url} alt={card.card_name} className="w-full h-full object-cover" /></div>
      <div className="flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            {editing ? (<div className="space-y-2"><Input value={editedName} onChange={(e) => setEditedName(e.target.value)} placeholder="Card name" className="h-8 text-sm" /><Input value={editedSet} onChange={(e) => setEditedSet(e.target.value)} placeholder="Card set" className="h-8 text-sm" /></div>) : (<><p className="font-medium text-sm">{card.card_name}</p><p className="text-xs text-muted-foreground">{card.card_set || "Unknown set"}</p></>)}
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">{Math.round(card.confidence)}% conf</Badge>
        </div>
        {card.suggested_name && card.suggested_name !== card.card_name && !editing && (<Alert className="py-2"><AlertDescription className="text-xs"><span className="font-medium">OCR suggests:</span> {card.suggested_name}{card.suggested_set && ` (${card.suggested_set})`}<Button variant="link" size="sm" className="h-auto p-0 ml-2 text-xs" onClick={handleUseSuggestion}>Use this</Button></AlertDescription></Alert>)}
        <div className="flex gap-2">
          {editing ? (<><Button size="sm" variant="default" onClick={handleSave} className="h-7 text-xs"><Check className="h-3 w-3 mr-1" /> Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 text-xs">Cancel</Button></>) : (<><Button size="sm" variant="outline" onClick={() => setEditing(true)} className="h-7 text-xs"><Edit2 className="h-3 w-3 mr-1" /> Edit</Button><Button size="sm" variant="default" onClick={() => onVerify(card.id, card.card_name, card.card_set)} className="h-7 text-xs"><Check className="h-3 w-3 mr-1" /> Confirm</Button><Button size="sm" variant="ghost" onClick={() => onDismiss(card.id)} className="h-7 text-xs text-muted-foreground"><X className="h-3 w-3" /></Button></>)}
        </div>
      </div>
    </div>
  );
}
