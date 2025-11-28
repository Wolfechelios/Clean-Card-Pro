import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Camera, Grid3x3, RotateCcw, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { SlotProgress } from "./SlotProgress";
import { detectCardRegions, extractCardImage } from "@/lib/binder/preprocess";
import { enhancedCardIdentify } from "@/lib/enhancedCardIdentify";
import { fetchCardPrices } from "@/lib/fetchCardPrices";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BinderScanProps {
  binderName: string;
  onComplete: () => void;
}

interface ScanResult {
  id: string;
  card_name: string;
  card_set?: string | null;
  card_number?: string | null;
  rarity?: string | null;
  image_url: string;
  thumbnail_url?: string;
  current_price_raw?: number;
  current_price_psa9?: number;
  current_price_psa10?: number;
  suggested_price?: number;
  success: boolean;
  error?: string;
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
    let objectUrl = "";

    try {
      // Get authenticated session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to scan cards");
        return;
      }

      // Load image
      const img = new Image();
      objectUrl = URL.createObjectURL(imageFile);
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = objectUrl;
      });

      // Create canvas and extract image data
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Detect individual card regions
      const regions = await detectCardRegions(imageData, columns, rows);
      setProgress({ total: totalCards, processed: 0, current: "Separating cards..." });

      // Process each card individually
      for (let i = 0; i < regions.length; i++) {
        setProgress({ 
          total: totalCards, 
          processed: i, 
          current: `Processing card ${i + 1} of ${totalCards}` 
        });

        try {
          const region = regions[i];
          
          // Extract individual card image
          const cardImageData = extractCardImage(canvas, region);
          const response = await fetch(cardImageData);
          const blob = await response.blob();

          // Upload to storage
          const cardId = crypto.randomUUID();
          const fileName = `cards/${cardId}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("card-images")
            .upload(fileName, blob, {
              contentType: "image/jpeg",
              cacheControl: "3600"
            });

          if (uploadError) {
            console.error("Upload error:", uploadError);
            results.push({
              id: `failed-${i}`,
              card_name: "Upload Failed",
              image_url: cardImageData,
              success: false,
              error: uploadError.message
            });
            continue;
          }

          // Get public URL for the uploaded image
          const { data: { publicUrl } } = supabase.storage
            .from("card-images")
            .getPublicUrl(fileName);

          // Identify card using enhanced AI
          let cardData;
          try {
            cardData = await enhancedCardIdentify(publicUrl);
          } catch (identifyError: any) {
            console.error("Identification error:", identifyError);
            results.push({
              id: `failed-${i}`,
              card_name: "Failed to identify",
              image_url: publicUrl,
              success: false,
              error: identifyError.message
            });
            continue;
          }

          // Fetch pricing data
          let pricingData;
          try {
            pricingData = await fetchCardPrices(
              cardData.card_name,
              cardData.card_set,
              cardData.card_number,
              cardData.game_type,
              cardData.sport_type
            );
          } catch (pricingError) {
            console.error("Pricing error:", pricingError);
            // Continue without pricing data
            pricingData = {
              raw: null,
              psa9: null,
              psa10: null,
              suggested: null,
              ebayUrl: null,
              source: "none"
            };
          }

          // Insert into database
          const { data: insertedCard, error: insertError } = await supabase
            .from("cards")
            .insert({
              user_id: session.user.id,
              card_name: cardData.card_name,
              card_set: cardData.card_set,
              card_number: cardData.card_number,
              rarity: cardData.rarity,
              edition: cardData.edition,
              game_type: cardData.game_type,
              sport_type: cardData.sport_type,
              image_url: publicUrl,
              thumbnail_url: publicUrl,
              collection_name: binderName,
              current_price_raw: pricingData.raw,
              current_price_psa9: pricingData.psa9,
              current_price_psa10: pricingData.psa10,
              suggested_price: pricingData.suggested,
              ebay_listing_url: pricingData.ebayUrl,
              ocr_confidence: cardData.confidence,
            })
            .select()
            .single();

          if (insertError) {
            console.error("Insert error:", insertError);
            results.push({
              id: `failed-${i}`,
              card_name: cardData.card_name || "Insert Failed",
              image_url: publicUrl,
              success: false,
              error: insertError.message
            });
            continue;
          }

          // Success!
          results.push({
            id: insertedCard.id,
            card_name: cardData.card_name,
            card_set: cardData.card_set,
            card_number: cardData.card_number,
            rarity: cardData.rarity,
            image_url: publicUrl,
            thumbnail_url: publicUrl,
            current_price_raw: pricingData.raw || undefined,
            current_price_psa9: pricingData.psa9 || undefined,
            current_price_psa10: pricingData.psa10 || undefined,
            suggested_price: pricingData.suggested || undefined,
            success: true
          });

        } catch (cardError: any) {
          console.error(`Error processing card ${i + 1}:`, cardError);
          results.push({
            id: `failed-${i}`,
            card_name: "Processing Error",
            image_url: "",
            success: false,
            error: cardError.message
          });
        }
      }

      // Complete
      setProgress({ total: totalCards, processed: totalCards, current: "Complete!" });
      setScanResults(results);
      setShowResults(true);
      
      const successCount = results.filter(r => r?.success).length;
      const failCount = results.filter(r => r && !r.success).length;
      
      if (successCount > 0) {
        toast.success(
          `Successfully identified and added ${successCount} card${successCount !== 1 ? 's' : ''} to your collection!${
            failCount > 0 ? ` (${failCount} failed)` : ''
          }`
        );
      } else {
        toast.error("Failed to identify any cards. Please try again with a clearer image.");
      }

    } catch (error: any) {
      console.error("Error processing binder page:", error);
      toast.error(`Failed to process binder page: ${error.message}`);
      setScanResults([]);
      setShowResults(true);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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

            <div className={`grid gap-3 ${
              layout === "3x3" ? "grid-cols-3" : 
              layout === "3x4" ? "grid-cols-3" : 
              "grid-cols-4"
            }`}>
              {scanResults.map((result, index) => (
                <div key={index} className="relative group">
                  {result ? (
                    <div className="relative">
                      {result.image_url ? (
                        <img
                          src={result.image_url}
                          alt={result.card_name}
                          className="w-full aspect-[5/7] object-cover rounded-lg border-2 border-neutral-700 group-hover:border-primary/50 transition-colors"
                        />
                      ) : (
                        <div className="w-full aspect-[5/7] bg-neutral-800 rounded-lg border-2 border-neutral-700 flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        {result.success ? (
                          <div className="bg-green-500 rounded-full p-1">
                            <CheckCircle className="h-4 w-4 text-white" />
                          </div>
                        ) : (
                          <div className="bg-red-500 rounded-full p-1">
                            <XCircle className="h-4 w-4 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent p-2 rounded-b-lg">
                        <p className="text-xs text-white font-semibold truncate">
                          {result.card_name}
                        </p>
                        {result.card_set && (
                          <p className="text-[10px] text-neutral-300 truncate">
                            {result.card_set}
                          </p>
                        )}
                        {result.success && result.suggested_price != null && (
                          <p className="text-xs text-green-400 font-medium">
                            ${result.suggested_price.toFixed(2)}
                          </p>
                        )}
                        {!result.success && result.error && (
                          <p className="text-[10px] text-red-400 truncate">
                            {result.error}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full aspect-[5/7] border-2 border-dashed border-neutral-700 rounded-lg flex items-center justify-center">
                      <p className="text-xs text-muted-foreground">Empty slot</p>
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
