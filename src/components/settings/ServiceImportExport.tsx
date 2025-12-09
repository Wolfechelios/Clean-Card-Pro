import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Upload, FileSpreadsheet, AlertCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

interface ServiceImportExportProps {
  userId: string | null;
  totalCards: number;
  onComplete: () => void;
}

type ExportFormat = "sportscardpro" | "pricecharting" | "generic";
type ImportFormat = "sportscardpro" | "pricecharting" | "generic";

export default function ServiceImportExport({ userId, totalCards, onComplete }: ServiceImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importFormat, setImportFormat] = useState<ImportFormat>("generic");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // SportsCardPro format columns
  const exportToSportsCardPro = async () => {
    if (!userId) return;
    
    try {
      const { data: cards, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId);

      if (error) throw error;
      if (!cards || cards.length === 0) {
        toast.error("No cards to export");
        return;
      }

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

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Cards");
      
      XLSX.writeFile(wb, `sportscardpro-export-${new Date().toISOString().split('T')[0]}.csv`);
      toast.success(`Exported ${cards.length} cards for SportsCardPro`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export cards");
    }
  };

  // PriceCharting format columns
  const exportToPriceCharting = async () => {
    if (!userId) return;
    
    try {
      const { data: cards, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId);

      if (error) throw error;
      if (!cards || cards.length === 0) {
        toast.error("No cards to export");
        return;
      }

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

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Collection");
      
      XLSX.writeFile(wb, `pricecharting-export-${new Date().toISOString().split('T')[0]}.csv`);
      toast.success(`Exported ${cards.length} cards for PriceCharting`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export cards");
    }
  };

  // Generic format (internal app format)
  const exportToGeneric = async () => {
    if (!userId) return;
    
    try {
      const { data: cards, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId);

      if (error) throw error;
      if (!cards || cards.length === 0) {
        toast.error("No cards to export");
        return;
      }

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
        "Collection": card.collection_name || "",
        "Notes": card.notes || "",
        "Image URL": card.image_url || "",
        "Added Date": new Date(card.created_at).toLocaleDateString(),
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Cards");
      
      XLSX.writeFile(wb, `card-collection-${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success(`Exported ${cards.length} cards`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export cards");
    }
  };

  const mapConditionToPriceCharting = (condition: string | null): string => {
    const conditionMap: Record<string, string> = {
      "mint": "Mint",
      "near-mint": "Near Mint",
      "excellent": "Good",
      "good": "Good",
      "fair": "Fair",
      "poor": "Poor",
      "ungraded": "Loose",
      "PSA 10": "Graded",
      "PSA 9": "Graded",
      "PSA 8": "Graded",
    };
    return conditionMap[condition || "ungraded"] || "Loose";
  };

  const mapConditionFromPriceCharting = (condition: string): string => {
    const conditionMap: Record<string, string> = {
      "Mint": "mint",
      "Near Mint": "near-mint",
      "Good": "good",
      "Fair": "fair",
      "Poor": "poor",
      "Loose": "ungraded",
      "Graded": "ungraded",
      "Complete": "ungraded",
    };
    return conditionMap[condition] || "ungraded";
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !userId) return;

    setImporting(true);
    setImportProgress(0);

    try {
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

          const batchSize = 10;
          let imported = 0;

          for (let i = 0; i < jsonData.length; i += batchSize) {
            const batch = jsonData.slice(i, i + batchSize);
            const cardsToInsert = batch.map((row: any) => parseRowByFormat(row, importFormat, userId));

            const { error } = await supabase.from("cards").insert(cardsToInsert);
            if (error) {
              console.error("Batch import error:", error);
            } else {
              imported += batch.length;
            }

            setImportProgress(Math.round(((i + batch.length) / jsonData.length) * 100));
          }

          toast.success(`Successfully imported ${imported} cards`);
          onComplete();
        } catch (error) {
          console.error("Import error:", error);
          toast.error("Failed to process file");
        } finally {
          setImporting(false);
          setImportProgress(0);
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

  const parseRowByFormat = (row: any, format: ImportFormat, userId: string) => {
    switch (format) {
      case "sportscardpro":
        return {
          user_id: userId,
          card_name: row["Player/Card Name"] || row["Player"] || row["Card Name"] || "Unknown Card",
          card_set: row["Set"] || row["Brand"] || null,
          card_number: row["Card Number"] || row["#"] || null,
          rarity: row["Variation"] || null,
          edition: row["Variation"] || null,
          condition: row["Grade"] ? `PSA ${row["Grade"]}` : "ungraded",
          sport_type: row["Sport"] || null,
          notes: row["Notes"] || null,
          image_url: "https://placehold.co/300x400?text=Imported",
        };
      
      case "pricecharting":
        return {
          user_id: userId,
          card_name: row["product-name"] || row["Product Name"] || "Unknown Card",
          card_set: null,
          card_number: row["upc"] || null,
          rarity: null,
          condition: mapConditionFromPriceCharting(row["condition"] || "Loose"),
          game_type: row["console-name"] || row["Console"] || null,
          notes: row["notes"] || row["Notes"] || null,
          image_url: "https://placehold.co/300x400?text=Imported",
        };
      
      default: // generic
        return {
          user_id: userId,
          card_name: row["Card Name"] || row["card_name"] || row["Name"] || "Unknown Card",
          card_set: row["Set"] || row["card_set"] || null,
          card_number: row["Card Number"] || row["card_number"] || row["Number"] || null,
          rarity: row["Rarity"] || row["rarity"] || null,
          edition: row["Edition"] || row["edition"] || null,
          condition: row["Condition"] || row["condition"] || "ungraded",
          game_type: row["Game Type"] || row["game_type"] || null,
          sport_type: row["Sport Type"] || row["sport_type"] || null,
          current_price_raw: parseFloat(row["Price (Raw)"] || row["Price"] || row["current_price_raw"] || 0) || null,
          current_price_psa9: parseFloat(row["Price (PSA 9)"] || row["current_price_psa9"] || 0) || null,
          current_price_psa10: parseFloat(row["Price (PSA 10)"] || row["current_price_psa10"] || 0) || null,
          collection_name: row["Collection"] || row["collection_name"] || null,
          notes: row["Notes"] || row["notes"] || null,
          image_url: row["Image URL"] || row["image_url"] || "https://placehold.co/300x400?text=Imported",
        };
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Import / Export
        </CardTitle>
        <CardDescription>Import from or export to external services</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {importing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Importing cards...</span>
              <span>{importProgress}%</span>
            </div>
            <Progress value={importProgress} />
          </div>
        )}

        {/* Export Section */}
        <div className="space-y-4">
          <h3 className="font-semibold text-sm">Export Collection</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button 
              variant="outline" 
              onClick={exportToSportsCardPro}
              disabled={totalCards === 0}
              className="flex-col h-auto py-3"
            >
              <Download className="h-4 w-4 mb-1" />
              <span className="text-xs">SportsCardPro</span>
              <span className="text-[10px] text-muted-foreground">(.csv)</span>
            </Button>
            <Button 
              variant="outline" 
              onClick={exportToPriceCharting}
              disabled={totalCards === 0}
              className="flex-col h-auto py-3"
            >
              <Download className="h-4 w-4 mb-1" />
              <span className="text-xs">PriceCharting</span>
              <span className="text-[10px] text-muted-foreground">(.csv)</span>
            </Button>
            <Button 
              variant="outline" 
              onClick={exportToGeneric}
              disabled={totalCards === 0}
              className="flex-col h-auto py-3"
            >
              <Download className="h-4 w-4 mb-1" />
              <span className="text-xs">Full Export</span>
              <span className="text-[10px] text-muted-foreground">(.xlsx)</span>
            </Button>
          </div>
          {totalCards === 0 && (
            <p className="text-xs text-muted-foreground">No cards to export</p>
          )}
        </div>

        <Separator />

        {/* Import Section */}
        <div className="space-y-4">
          <h3 className="font-semibold text-sm">Import Collection</h3>
          
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Select the format that matches your file source, then upload your CSV or Excel file.
            </AlertDescription>
          </Alert>

          <Tabs value={importFormat} onValueChange={(v) => setImportFormat(v as ImportFormat)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="generic" className="text-xs">Generic</TabsTrigger>
              <TabsTrigger value="sportscardpro" className="text-xs">SportsCardPro</TabsTrigger>
              <TabsTrigger value="pricecharting" className="text-xs">PriceCharting</TabsTrigger>
            </TabsList>
            
            <TabsContent value="generic" className="space-y-3 mt-4">
              <p className="text-xs text-muted-foreground">
                Standard format with columns: Card Name, Set, Card Number, Rarity, Condition, Price, etc.
              </p>
            </TabsContent>
            
            <TabsContent value="sportscardpro" className="space-y-3 mt-4">
              <p className="text-xs text-muted-foreground">
                Import from SportsCardPro exports. Expected columns: Player/Card Name, Year, Set, Card Number, Variation, Grade, Sport
              </p>
              <a 
                href="https://www.sportscardpro.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Visit SportsCardPro <ExternalLink className="h-3 w-3" />
              </a>
            </TabsContent>
            
            <TabsContent value="pricecharting" className="space-y-3 mt-4">
              <p className="text-xs text-muted-foreground">
                Import from PriceCharting exports. Expected columns: product-name, console-name, upc, condition, quantity
              </p>
              <a 
                href="https://www.pricecharting.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Visit PriceCharting <ExternalLink className="h-3 w-3" />
              </a>
            </TabsContent>
          </Tabs>

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
            disabled={importing || !userId}
            className="w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import {importFormat === "generic" ? "CSV/Excel" : importFormat === "sportscardpro" ? "SportsCardPro" : "PriceCharting"} File
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
