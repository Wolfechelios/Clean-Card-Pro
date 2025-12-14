import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

interface ImportExportProps {
  cards: any[];
  onImportComplete: () => void;
}

// Helper to lookup image for a card
async function lookupCardImage(cardName: string, cardSet: string | null, gameType: string | null): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-card-image-url', {
      body: { cardName, cardSet, gameType }
    });
    
    if (error || !data?.imageUrl) return null;
    
    // Don't return placeholder URLs
    if (data.imageUrl.includes('placehold.co') || data.imageUrl.includes('placeholder')) {
      return null;
    }
    
    return data.imageUrl;
  } catch {
    return null;
  }
}

export default function ImportExport({ cards, onImportComplete }: ImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportToExcel = () => {
    if (cards.length === 0) {
      toast.error("No cards to export");
      return;
    }

    const exportData = cards.map(card => ({
      "Card Name": card.card_name,
      "Set": card.card_set || "",
      "Card Number": card.card_number || "",
      "Rarity": card.rarity || "",
      "Condition": card.condition || "",
      "Price (Raw)": card.current_price_raw || 0,
      "Price (PSA 9)": card.current_price_psa9 || 0,
      "Price (PSA 10)": card.current_price_psa10 || 0,
      "Collection": card.collection_name || "",
      "Added Date": new Date(card.created_at).toLocaleDateString(),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cards");
    
    XLSX.writeFile(wb, `card-collection-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`Exported ${cards.length} cards`);
  };

  const exportToCSV = () => {
    if (cards.length === 0) {
      toast.error("No cards to export");
      return;
    }

    const headers = ["Card Name", "Set", "Card Number", "Rarity", "Condition", "Price", "Collection", "Added Date"];
    const csvContent = [
      headers.join(","),
      ...cards.map(card => [
        `"${card.card_name}"`,
        `"${card.card_set || ""}"`,
        `"${card.card_number || ""}"`,
        `"${card.rarity || ""}"`,
        `"${card.condition || ""}"`,
        card.current_price_raw || 0,
        `"${card.collection_name || ""}"`,
        new Date(card.created_at).toLocaleDateString(),
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
      if (!session) {
        toast.error("You must be logged in to import cards");
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          if (jsonData.length === 0) {
            toast.error("No data found in file");
            setImporting(false);
            return;
          }

          // Process cards in batches
          const batchSize = 10;
          let imported = 0;
          let errors = 0;
          let imagesFound = 0;

          for (let i = 0; i < jsonData.length; i += batchSize) {
            const batch = jsonData.slice(i, i + batchSize);
            
            // Prepare cards with image lookup for those without images
            setProgressMessage(`Processing batch ${Math.floor(i / batchSize) + 1}...`);
            
            const cardsToInsert = await Promise.all(batch.map(async (row: any) => {
              const existingImageUrl = row["Image URL"] || row["image_url"];
              const cardName = row["Card Name"] || row["card_name"] || "Unknown Card";
              const cardSet = row["Set"] || row["card_set"] || null;
              const gameType = row["Game Type"] || row["game_type"] || null;
              
              let finalImageUrl = existingImageUrl;
              
              // If no image URL or it's a placeholder, try to look one up
              if (!existingImageUrl || existingImageUrl.includes('placehold') || existingImageUrl.includes('placeholder')) {
                const lookedUpImage = await lookupCardImage(cardName, cardSet, gameType);
                if (lookedUpImage) {
                  finalImageUrl = lookedUpImage;
                  imagesFound++;
                } else {
                  // Use a minimal placeholder that we can identify later
                  finalImageUrl = `https://placehold.co/300x400/1a1a2e/eee?text=${encodeURIComponent(cardName.substring(0, 15))}`;
                }
              }
              
              return {
                user_id: session.user.id,
                card_name: cardName,
                card_set: cardSet,
                card_number: row["Card Number"] || row["card_number"] || null,
                rarity: row["Rarity"] || row["rarity"] || null,
                condition: row["Condition"] || row["condition"] || "ungraded",
                current_price_raw: parseFloat(row["Price (Raw)"] || row["Price"] || row["current_price_raw"] || 0),
                current_price_psa9: parseFloat(row["Price (PSA 9)"] || row["current_price_psa9"] || 0),
                current_price_psa10: parseFloat(row["Price (PSA 10)"] || row["current_price_psa10"] || 0),
                collection_name: row["Collection"] || row["collection_name"] || null,
                game_type: gameType,
                image_url: finalImageUrl,
              };
            }));

            const { error } = await supabase
              .from("cards")
              .insert(cardsToInsert);

            if (error) {
              console.error("Batch import error:", error);
              errors += batch.length;
            } else {
              imported += batch.length;
            }

            setImportProgress(Math.round(((i + batch.length) / jsonData.length) * 100));
          }

          if (imported > 0) {
            const imageMsg = imagesFound > 0 ? `, found ${imagesFound} images` : "";
            toast.success(`Imported ${imported} cards${imageMsg}${errors > 0 ? `, ${errors} failed` : ""}`);
            onImportComplete();
          } else {
            toast.error("Failed to import cards");
          }
        } catch (error) {
          console.error("Import error:", error);
          toast.error("Failed to process file");
        } finally {
          setImporting(false);
          setImportProgress(0);
          setProgressMessage("");
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }
      };

      reader.readAsArrayBuffer(file);
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
          <AlertDescription>
            Export your collection or import cards from Excel/CSV files. Required columns: Card Name (required), Set, Card Number, Rarity, Condition, Price
          </AlertDescription>
        </Alert>

        {importing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{progressMessage || "Importing cards..."}</span>
              <span>{importProgress}%</span>
            </div>
            <Progress value={importProgress} />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="font-semibold">Export</h4>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={exportToExcel} disabled={cards.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export to Excel (.xlsx)
              </Button>
              <Button variant="outline" onClick={exportToCSV} disabled={cards.length === 0}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export to CSV (.csv)
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold">Import</h4>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              disabled={importing}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="w-full"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import from Excel/CSV
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}