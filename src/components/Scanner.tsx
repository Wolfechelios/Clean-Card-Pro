import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Upload, Camera, Loader2, CheckCircle, X } from "lucide-react";
import { createWorker } from "tesseract.js";

interface ScannerProps {
  userId: string;
}

interface OCRResult {
  cardName: string;
  cardSet: string;
  cardNumber: string;
  confidence: number;
  rawText: string;
}

const Scanner = ({ userId }: ScannerProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(selectedFile);
      setOcrResult(null);
    }
  };

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith("image/")) {
      setFile(droppedFile);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(droppedFile);
      setOcrResult(null);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  const performOCR = async (imageFile: File): Promise<OCRResult> => {
    setScanProgress(10);
    const worker = await createWorker("eng");
    
    setScanProgress(50);
    const { data } = await worker.recognize(imageFile);
    
    setScanProgress(80);
    await worker.terminate();

    // Parse OCR text to extract card details
    const lines = data.text.split("\n").filter((line) => line.trim());
    const cardName = lines[0] || "Unknown Card";
    const cardSet = lines.find((line) => line.toLowerCase().includes("set")) || "";
    const cardNumber = lines.find((line) => /\d+\/\d+/.test(line)) || "";

    return {
      cardName: cardName.trim(),
      cardSet: cardSet.replace(/set/i, "").trim(),
      cardNumber: cardNumber.trim(),
      confidence: data.confidence,
      rawText: data.text,
    };
  };

  const handleScan = async () => {
    if (!file || !preview) {
      toast.error("Please select an image first");
      return;
    }

    setIsScanning(true);
    setScanProgress(0);

    try {
      // Perform OCR
      const ocr = await performOCR(file);
      setOcrResult(ocr);
      setScanProgress(90);

      // Upload image to Supabase Storage
      const fileExt = file.name.split(".").pop();
      const fileName = `${userId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("card-images")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("card-images")
        .getPublicUrl(fileName);

      // Save card to database
      const { error: dbError } = await supabase.from("cards").insert({
        user_id: userId,
        card_name: ocr.cardName,
        card_set: ocr.cardSet,
        card_number: ocr.cardNumber,
        ocr_confidence: ocr.confidence,
        ocr_raw_text: ocr.rawText,
        image_url: publicUrl,
        thumbnail_url: publicUrl,
      });

      if (dbError) throw dbError;

      setScanProgress(100);
      toast.success("Card scanned and saved successfully!");
      
      // Reset form after short delay
      setTimeout(() => {
        setFile(null);
        setPreview(null);
        setOcrResult(null);
        setScanProgress(0);
        setIsScanning(false);
      }, 2000);
    } catch (error: any) {
      console.error("Scan error:", error);
      toast.error(error.message || "Error scanning card");
      setIsScanning(false);
      setScanProgress(0);
    }
  };

  const clearSelection = () => {
    setFile(null);
    setPreview(null);
    setOcrResult(null);
    setScanProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Upload Section */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Upload Card Image</CardTitle>
          <CardDescription>
            Drag and drop or click to select a card image
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="relative flex min-h-[300px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/20 p-6 transition-colors hover:border-primary hover:bg-muted/30"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {preview ? (
              <div className="relative w-full">
                <img
                  src={preview}
                  alt="Card preview"
                  className="mx-auto max-h-[300px] rounded-lg object-contain"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute right-2 top-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSelection();
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Drop your card image here</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Supports JPG, PNG, WEBP up to 20MB
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={handleScan}
            disabled={!file || isScanning}
            className="w-full"
            size="lg"
          >
            {isScanning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Camera className="mr-2 h-4 w-4" />
                Scan Card
              </>
            )}
          </Button>

          {isScanning && (
            <div className="space-y-2">
              <Progress value={scanProgress} />
              <p className="text-center text-sm text-muted-foreground">
                {scanProgress}% complete
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Scan Results</CardTitle>
          <CardDescription>
            Card details extracted from the image
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ocrResult ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-success/10 p-4">
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-5 w-5" />
                  <p className="font-medium">Scan Complete</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-muted-foreground">Card Name</Label>
                  <p className="text-lg font-semibold">{ocrResult.cardName}</p>
                </div>

                {ocrResult.cardSet && (
                  <div>
                    <Label className="text-muted-foreground">Set</Label>
                    <p>{ocrResult.cardSet}</p>
                  </div>
                )}

                {ocrResult.cardNumber && (
                  <div>
                    <Label className="text-muted-foreground">Card Number</Label>
                    <p>{ocrResult.cardNumber}</p>
                  </div>
                )}

                <div>
                  <Label className="text-muted-foreground">OCR Confidence</Label>
                  <div className="flex items-center gap-2">
                    <Progress value={ocrResult.confidence} className="flex-1" />
                    <span className="text-sm font-medium">
                      {ocrResult.confidence.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <Label className="text-muted-foreground">Raw OCR Text</Label>
                <p className="mt-2 text-sm font-mono">{ocrResult.rawText}</p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center text-center text-muted-foreground">
              <div className="space-y-2">
                <Camera className="mx-auto h-12 w-12 opacity-20" />
                <p>No scan results yet</p>
                <p className="text-sm">Upload and scan a card to see results</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Scanner;
