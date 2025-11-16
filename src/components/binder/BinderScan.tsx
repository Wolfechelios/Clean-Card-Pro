import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Camera, Grid3x3, RotateCcw, CheckCircle, XCircle } from "lucide-react";
import { SlotProgress } from "./SlotProgress";
import { detectCardRegions, extractCardImage } from "@/lib/binder/preprocess";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BinderScanProps {
  binderName: string;
  onComplete: () => void;
}

interface ScanResult {
  id: string;
  card_name: string;
  image_url: string;
  thumbnail_url?: string;
  current_price_raw?: number;
  success: boolean;
}

export function BinderScan({ binderName, onComplete }: BinderScanProps) {
  const [layout, setLayout] = useState<"3x3" | "3x4" | "4x3">("3x3");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ total: 0, processed: 0, current: "" });
  const [scanResults, setScanResults] = useState<(ScanResult | null)[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [lastImageFile, setLastImageFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const getLayoutDimensions = (layout: string) => {
    const [cols, rows] = layout.split("x").map(Number);
    return { columns: cols, rows };
  };

  const processBinderPage = async (imageFile: File) => {
    setIsProcessing(true);
    setShowResults(false);
    setLastImageFile(imageFile);
    const { columns, rows } = getLayoutDimensions(layout);
    const totalCards = columns * rows;
    const results: (ScanResult | null)[] = [];
    let imageUrl = "";

    try {
      const img = new Image();
      imageUrl = URL.createObjectURL(imageFile);
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const regions = await detectCardRegions(imageData, columns, rows);
      setProgress({ total: totalCards, processed: 0, current: "" });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      for (let i = 0; i < regions.length; i++) {
        setProgress({ total: totalCards, processed: i, current: `Card ${i + 1}` });

        const region = regions[i];
        const cardImageData = extractCardImage(canvas, region);

        const response = await fetch(cardImageData);
        const blob = await response.blob();

        const cardId = crypto.randomUUID();
        const fileName = `cards/${cardId}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("card-images")
          .upload(fileName, blob);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          results.push({
            id: `failed-${i}`,
            card_name: "Upload Failed",
            image_url: cardImageData,
            success: false,
          });
          continue;
        }

        const { data: signedUrlData, error: urlError } = await supabase.storage
          .from("card-images")
          .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year

        if (urlError) {
          console.error("URL error:", urlError);
          results.push({
            id: `failed-${i}`,
            card_name: "URL Generation Failed",
            image_url: cardImageData,
            success: false,
          });
          continue;
        }

        const imageUrl = signedUrlData.signedUrl;

        const { data: cardData, error: identifyError } = await supabase.functions
          .invoke("identify-card", {
            body: { imageUrl: imageUrl },
          });

        if (!identifyError && cardData) {
          const { data: insertedCard } = await supabase.from("cards").insert({
            user_id: session.user.id,
            card_name: cardData.cardName || "Unknown Card",
            card_set: cardData.setName,
            card_number: cardData.cardNumber,
            rarity: cardData.rarity,
            image_url: imageUrl,
            thumbnail_url: imageUrl,
            collection_name: binderName,
            current_price_raw: cardData.pricing?.currentPriceRaw,
            current_price_psa9: cardData.pricing?.psa9Price,
            current_price_psa10: cardData.pricing?.psa10Price,
            suggested_price: cardData.pricing?.suggestedPrice,
            ocr_raw_text: cardData.rawText,
          }).select().single();

          results.push({
            id: insertedCard?.id || `temp-${i}`,
            card_name: cardData.cardName || "Unknown Card",
            image_url: imageUrl,
            thumbnail_url: imageUrl,
            current_price_raw: cardData.pricing?.currentPriceRaw,
            success: true,
          });
        } else {
          results.push({
            id: `failed-${i}`,
            card_name: "Failed to identify",
            image_url: imageUrl,
            success: false,
          });
        }
      }

      setProgress({ total: totalCards, processed: totalCards, current: "Complete!" });
      setScanResults(results);
      setShowResults(true);
      
      const successCount = results.filter(r => r?.success).length;
      const failCount = results.filter(r => r && !r.success).length;
      
      if (successCount > 0) {
        toast.success(`Successfully identified ${successCount} cards${failCount > 0 ? `, ${failCount} failed` : ''}`);
      } else {
        toast.error("Failed to identify any cards");
      }
    } catch (error) {
      console.error("Error processing binder page:", error);
      toast.error("Failed to process binder page");
      setScanResults([]);
      setShowResults(true);
    } finally {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setIsProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processBinderPage(file);
  };

  const handleRetry = () => {
    if (lastImageFile) {
      processBinderPage(lastImageFile);
    } else {
      toast.error("No previous scan to retry");
    }
  };

  const handleNewScan = () => {
    setScanResults([]);
    setShowResults(false);
    setLastImageFile(null);
    setProgress({ total: 0, processed: 0, current: "" });
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (error) {
      toast.error("Failed to access camera");
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "binder-scan.jpg", { type: "image/jpeg" });
        processBinderPage(file);
        stopCamera();
      }
    });
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      setIsCameraActive(false);
    }
  };

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid3x3 className="h-5 w-5" />
          Scan Binder Page
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showResults ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Scan Results</h3>
                <p className="text-sm text-muted-foreground">
                  {scanResults.filter(r => r?.success).length} of {scanResults.length} cards identified
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleRetry} variant="outline" size="sm">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
                <Button onClick={handleNewScan} size="sm" variant="outline">
                  New Scan
                </Button>
                <Button onClick={onComplete} size="sm" variant="default">
                  Done
                </Button>
              </div>
            </div>

            <div className={`grid gap-4 ${
              layout === "3x3" ? "grid-cols-3" : 
              layout === "3x4" ? "grid-cols-3" : 
              "grid-cols-4"
            }`}>
              {scanResults.map((result, index) => (
                <div key={index} className="relative">
                  {result ? (
                    <div className="relative">
                      <img
                        src={result.image_url}
                        alt={result.card_name}
                        className="w-full aspect-[3/4] object-cover rounded-lg border border-neutral-700"
                      />
                      <div className="absolute top-2 right-2">
                        {result.success ? (
                          <CheckCircle className="h-5 w-5 text-green-500 bg-white rounded-full" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500 bg-white rounded-full" />
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-lg">
                        <p className="text-xs text-white font-medium truncate">
                          {result.card_name}
                        </p>
                        {result.current_price_raw != null && (
                          <p className="text-xs text-neutral-300">
                            ${result.current_price_raw.toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full aspect-[3/4] border-2 border-dashed border-neutral-700 rounded-lg flex items-center justify-center">
                      <p className="text-sm text-muted-foreground">No card</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : isProcessing ? (
          <SlotProgress
            total={progress.total}
            processed={progress.processed}
            current={progress.current}
          />
        ) : (
          <>
            <div>
              <Label>Binder Layout</Label>
              <Select value={layout} onValueChange={(v) => setLayout(v as any)}>
                <SelectTrigger className="bg-neutral-800 border-neutral-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3x3">3x3 (9 cards)</SelectItem>
                  <SelectItem value="3x4">3x4 (12 cards)</SelectItem>
                  <SelectItem value="4x3">4x3 (12 cards)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isCameraActive ? (
              <div className="space-y-3">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded border border-neutral-700"
                />
                <div className="flex gap-2">
                  <Button onClick={capturePhoto} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Capture Photo
                  </Button>
                  <Button onClick={stopCamera} variant="outline">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button onClick={() => fileInputRef.current?.click()} className="flex-1">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Image
                </Button>
                <Button onClick={startCamera} variant="outline" className="flex-1">
                  <Camera className="h-4 w-4 mr-2" />
                  Use Camera
                </Button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
