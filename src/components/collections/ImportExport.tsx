import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Upload, FileSpreadsheet, AlertCircle, Cloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { checkImportAnomaly } from "@/lib/scanAnomalyDetector";
import * as ExcelJS from "exceljs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface ImportExportProps {
  cards: any[];
  onImportComplete: () => void;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function readSpreadsheetFile(file: File): Promise<any[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [];
    const parseLine = (line: string) => {
      const out: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; }
        } else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; } else { cur += ch; }
      }
      out.push(cur);
      return out.map(v => v.trim());
    };
    const headers = parseLine(lines[0]).map(h => h.replace(/^"(.*)"$/, "$1").trim());
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (cols.every(c => c === "")) continue;
      const obj: any = {};
      headers.forEach((h, idx) => (obj[h] = cols[idx] ?? ""));
      rows.push(obj);
    }
    return rows;
  }
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headerRow = ws.getRow(1).values as any[];
  const headers = headerRow.slice(1).map(v => String(v ?? "").trim());
  const rows: any[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values as any[];
    const obj: any = {};
    let hasAny = false;
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      const val = values[i + 1];
      const norm = val instanceof Date ? val.toISOString() : (val ?? "");
      if (String(norm).trim() !== "") hasAny = true;
      obj[key] = norm;
    }
    if (hasAny) rows.push(obj);
  });
  return rows;
}

async function lookupCardImage(cardName: string, cardSet: string | null, gameType: string | null): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-card-image-url', { body: { cardName, cardSet, gameType } });
    if (error || !data?.imageUrl) return null;
    if (data.imageUrl.includes('placehold.co') || data.imageUrl.includes('placeholder')) return null;
    return data.imageUrl;
  } catch { return null; }
}

async function storeImageToCloud(cardId: string, imageUrl: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('attach-image', { body: { cardId, remoteImageUrl: imageUrl } });
    return !error && data?.success;
  } catch { return false; }
}

export default function ImportExport({ cards, onImportComplete }: ImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [autoStoreImages, setAutoStoreImages] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportToExcel = async () => {
    if (cards.length === 0) { toast.error("No cards to export"); return; }
    const exportData = cards.map(card => ({
      "Card Name": card.card_name, "Set": card.card_set || "", "Card Number": card.card_number || "",
      "Rarity": card.rarity || "", "Condition": card.condition || "",
      "Price (Raw)": card.current_price_raw || 0, "Price (PSA 9)": card.current_price_psa9 || 0,
      "Price (PSA 10)": card.current_price_psa10 || 0,
      "Collection": (card.card_set || card.collection_name || ""),
      "Added Date": new Date(card.created_at).toLocaleDateString(),
    }));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Cards");
    const headers = Object.keys(exportData[0] || {});
    ws.addRow(headers);
    exportData.forEach(row => ws.addRow(headers.map(h => row[h as keyof typeof row])));
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    downloadBlob(`card-collection-${new Date().toISOString().split('T')[0]}.xlsx`, blob);
    toast.success(`Exported ${cards.length} cards`);
  };

  const exportToCSV = () => {
    if (cards.length === 0) { toast.error("No cards to export"); return; }
    const headers = ["Card Name", "Set", "Card Number", "Rarity", "Condition", "Price", "Collection", "Added Date"];
    const csvContent = [
      headers.join(","),
      ...cards.map(card => [
        `"${card.card_name}"`, `"${card.card_set || ""}"`, `"${card.card_number || ""}"`,
        `"${card.rarity || ""}"`, `"${card.condition || ""}"`, card.current_price_raw || 0,
        `"${card.collection_name || ""}"`, new Date(card.created_at).toLocaleDateString(),
      ].join(","))
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-collection-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${cards.length} cards to CSV`);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportProgress(0);
    setProgressMessage("Reading file...");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("You must be logged in to import cards"); return; }

      const jsonData = await readSpreadsheetFile(file);
      if (jsonData.length === 0) { toast.error("No data found in file"); setImporting(false); return; }

      // ─── Pre-insert anomaly check ───
      const parsedNames = jsonData.map((row: any) => row["Card Name"] || row["card_name"] || row["Name"] || "Unknown Card");
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

      const batchSize = 10;
      let imported = 0;
      let errors = 0;
      let imagesFound = 0;
      let imagesStored = 0;
      const cardsToStore: { id: string; imageUrl: string }[] = [];

      for (let i = 0; i < jsonData.length; i += batchSize) {
        const batch = jsonData.slice(i, i + batchSize);
        setProgressMessage(`Processing batch ${Math.floor(i / batchSize) + 1}...`);
        const cardsToInsert = await Promise.all(batch.map(async (row: any) => {
          const existingImageUrl = row["Image URL"] || row["image_url"];
          const cardName = row["Card Name"] || row["card_name"] || "Unknown Card";
          const cardSet = row["Set"] || row["card_set"] || null;
          const gameType = row["Game Type"] || row["game_type"] || null;
          let finalImageUrl = existingImageUrl;
          let isExternalUrl = false;
          if (!existingImageUrl || String(existingImageUrl).includes('placehold') || String(existingImageUrl).includes('placeholder')) {
            const lookedUpImage = await lookupCardImage(cardName, cardSet, gameType);
            if (lookedUpImage) { finalImageUrl = lookedUpImage; imagesFound++; isExternalUrl = true; }
            else { finalImageUrl = ""; }
          } else if (existingImageUrl && !String(existingImageUrl).includes('supabase')) { isExternalUrl = true; }
          return {
            user_id: session.user.id, card_name: cardName, card_set: cardSet,
            card_number: row["Card Number"] || row["card_number"] || null,
            rarity: row["Rarity"] || row["rarity"] || null,
            condition: row["Condition"] || row["condition"] || "ungraded",
            current_price_raw: parseFloat(row["Price (Raw)"] || row["Price"] || row["current_price_raw"] || 0),
            current_price_psa9: parseFloat(row["Price (PSA 9)"] || row["current_price_psa9"] || 0),
            current_price_psa10: parseFloat(row["Price (PSA 10)"] || row["current_price_psa10"] || 0),
            collection_name: (row["Set"] || row["card_set"] || row["Collection"] || row["collection_name"] || null),
            game_type: gameType, image_url: finalImageUrl, _isExternalUrl: isExternalUrl,
          };
        }));
        const cleanCards = cardsToInsert.map(({ _isExternalUrl, ...card }) => card);
        const { data: insertedCards, error } = await supabase.from("cards").insert(cleanCards).select("id, image_url");
        if (error) { console.error("Batch import error:", error); errors += batch.length; }
        else {
          imported += batch.length;
          if (autoStoreImages && insertedCards) {
            insertedCards.forEach((card, idx) => {
              const originalCard = cardsToInsert[idx];
              if (originalCard._isExternalUrl && card.image_url && card.image_url.length > 0) {
                cardsToStore.push({ id: card.id, imageUrl: card.image_url });
              }
            });
          }
        }
        setImportProgress(Math.round(((i + batch.length) / jsonData.length) * 100));
      }
      if (autoStoreImages && cardsToStore.length > 0) {
        setProgressMessage(`Storing ${cardsToStore.length} images to cloud...`);
        for (let i = 0; i < cardsToStore.length; i++) {
          const success = await storeImageToCloud(cardsToStore[i].id, cardsToStore[i].imageUrl);
          if (success) imagesStored++;
          setImportProgress(Math.round(((i + 1) / cardsToStore.length) * 100));
        }
      }
      let msg = `Imported ${imported} cards`;
      if (imagesFound > 0) msg += `, found ${imagesFound} images`;
      if (imagesStored > 0) msg += `, stored ${imagesStored} to cloud`;
      if (errors > 0) msg += `, ${errors} failed`;
      toast.success(msg);
      onImportComplete();
      setImporting(false);
      setImportProgress(100);
      if (fileInputRef.current) { fileInputRef.current.value = ""; }
    } catch (error) {
      console.error("File read error:", error);
      toast.error("Failed to read file");
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import / Export</CardTitle>
        <CardDescription>Manage your collection data</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Export your collection or import cards from Excel/CSV files. Required columns: Card Name (required), Set, Card Number, Rarity, Condition, Price</AlertDescription>
        </Alert>
        {importing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm"><span>{progressMessage || "Importing cards..."}</span><span>{importProgress}%</span></div>
            <Progress value={importProgress} />
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="font-semibold">Export</h4>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={exportToExcel} disabled={cards.length === 0}><Download className="h-4 w-4 mr-2" />Export to Excel (.xlsx)</Button>
              <Button variant="outline" onClick={exportToCSV} disabled={cards.length === 0}><FileSpreadsheet className="h-4 w-4 mr-2" />Export to CSV (.csv)</Button>
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="font-semibold">Import</h4>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
              <Switch id="auto-store" checked={autoStoreImages} onCheckedChange={setAutoStoreImages} />
              <Label htmlFor="auto-store" className="text-sm flex items-center gap-1.5 cursor-pointer"><Cloud className="h-4 w-4" />Store images to cloud</Label>
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" disabled={importing} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing} className="w-full"><Upload className="h-4 w-4 mr-2" />Import from Excel/CSV</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
