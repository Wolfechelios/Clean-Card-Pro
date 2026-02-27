import { useState, useRef, useEffect } from "react";
import { playShutterBeep } from "@/lib/audioBeeps";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Camera, Grid3x3, RotateCcw, CheckCircle, XCircle, Loader2, X } from "lucide-react";
import { SlotProgress } from "./SlotProgress";
import { detectCardRegions, extractCardImage } from "@/lib/binder/preprocess";
import { fetchCardPrices } from "@/lib/fetchCardPrices";
import { supabase } from "@/integrations/supabase/client";
import { insertCardDual } from "@/lib/localCards";
import { toast } from "sonner";
import { useCameraZoom } from "@/hooks/use-camera-zoom";
import { ZoomControls } from "@/components/scanner/ZoomControls";
import { getMaxQualityStream, captureMaxQualityPhoto } from "@/lib/camera-optimizations";
import { WhiteBalanceControl } from "@/components/scanner/WhiteBalanceControl";
import { withRetry } from "@/lib/retry";

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

interface ProcessingCard {
  index: number;
  imageUrl: string;
  status: 'uploading' | 'identifying' | 'pricing' | 'saving' | 'complete' | 'error';
  cardName?: string;
}

/**
 * FIX: Do NOT rely on fetch(data:image/...) to convert data URLs to blobs.
 * It fails on some mobile/webview environments.
 * This is deterministic and works everywhere.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mimeMatch = /data:(.*?);base64/i.exec(meta);
  const mime = mimeMatch?.[1] ?? "image/jpeg";

  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

  return new Blob([bytes], { type: mime });
}

// Use rapid-card-identify for faster OCR with retry logic for rate limits
async function rapidCardIdentify(imageUrl: string) {
  return withRetry(
    async () => {
      const { data, error } = await supabase.functions.invoke('rapid-card-identify', {
        body: { imageUrl }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Card identification failed');

      return {
        card_name: data.cardData?.card_name || data.cardName || 'Unknown Card',
        card_set: data.cardData?.card_set || data.setName || null,
        card_number: data.cardData?.card_number || data.cardNumber || null,
        rarity: data.cardData?.rarity || data.rarity || null,
        edition: null,
        game_type: data.cardData?.game_type || data.gameType || null,
        sport_type: data.cardData?.sport_type || data.sportType || null,
        confidence: data.cardData?.confidence || data.confidence || 0.5
      };
    },
    {
      retries: 5,
      baseMs: 800,
      maxMs: 10000,
      shouldRetry: (e) => /429|rate limit|timeout|network|502|503|504/i.test(String(e?.message ?? e)),
    }
  );
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [processingCards, setProcessingCards] = useState<ProcessingCard[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const { zoomLevel, zoomCapabilities, detectZoomCapabilities, setZoom, zoomIn, zoomOut, resetZoom } = useCameraZoom({
    streamRef
  });

  const getLayoutDimensions = (layoutStr: string) => {
    const [cols, rows] = layoutStr.split("x").map(Number);
    return { columns: cols, rows };
  };

  const { columns, rows } = getLayoutDimensions(layout);

  // Initialize zoom when camera becomes active
  useEffect(() => {
    if (isCameraActive && streamRef.current) {
      detectZoomCapabilities();
    }
  }, [isCameraActive, detectZoomCapabilities]);

  const updateProcessingCard = (index: number, updates: Partial<ProcessingCard>) => {
    setProcessingCards(prev => prev.map(card =>
      card.index === index ? { ...card, ...updates } : card
    ));
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
      setPreviewImage(objectUrl);

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

      // Initialize processing cards with preview images
      const initialProcessingCards: ProcessingCard[] = [];
      for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        const cardImageData = extractCardImage(canvas, region);
        initialProcessingCards.push({
          index: i,
          imageUrl: cardImageData,
          status: 'uploading'
        });
      }
      setProcessingCards(initialProcessingCards);

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

          // ✅ FIX HERE: replace fetch(dataUrl) with deterministic conversion
          const blob = dataUrlToBlob(cardImageData);

          updateProcessingCard(i, { status: 'uploading' });

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
            updateProcessingCard(i, { status: 'error' });
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

          updateProcessingCard(i, { status: 'identifying' });

          // Identify card using rapid OCR (same as rapid scan)
          let cardData;
          try {
            cardData = await rapidCardIdentify(publicUrl);
            updateProcessingCard(i, { cardName: cardData.card_name });
          } catch (identifyError: any) {
            console.error("Identification error:", identifyError);
            updateProcessingCard(i, { status: 'error' });
            results.push({
              id: `failed-${i}`,
              card_name: "Failed to identify",
              image_url: publicUrl,
              success: false,
              error: identifyError.message
            });
            continue;
          }

          updateProcessingCard(i, { status: 'pricing' });

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
            pricingData = {
              raw: null,
              psa9: null,
              psa10: null,
              suggested: null,
              ebayUrl: null,
              source: "none"
            };
          }

          updateProcessingCard(i, { status: 'saving' });

          // Insert into database
          const insertedCard = await insertCardDual({
            user_id: session.user.id,
            card_name: cardData.card_name,
            card_set: binderName,  // RULE: Set = Collection
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
          });

          if (!insertedCard) {
            console.error("Insert returned no data");
            updateProcessingCard(i, { status: 'error' });
            results.push({
              id: `failed-${i}`,
              card_name: cardData.card_name || "Insert Failed",
              image_url: publicUrl,
              success: false,
              error: "No data returned from insert"
            });
            continue;
          }

          updateProcessingCard(i, { status: 'complete' });

          // Success!
          results.push({
            id: insertedCard.id,
            card_name: cardData.card_name,
            card_set: binderName,  // RULE: Set = Collection
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
          updateProcessingCard(i, { status: 'error' });
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
      setProcessingCards([]);

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
      setProcessingCards([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Show preview before processing
      const objectUrl = URL.createObjectURL(file);
      setPreviewImage(objectUrl);
      processBinderPage(file);
    }
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
    setPreviewImage(null);
    setProcessingCards([]);
    setProgress({ total: 0, processed: 0, current: "" });
  };

  const startCamera = async () => {
    try {
      // Use maximum quality camera with fast autofocus
      const stream = await getMaxQualityStream('environment');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraActive(true);

        // Log resolution
        const settings = stream.getVideoTracks()[0]?.getSettings?.();
        console.log(`Binder camera started: ${settings?.width}x${settings?.height}`);
      }
    } catch (error) {
      toast.error("Failed to access camera");
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;

    try {
      // Capture with anti-glare and OCR enhancement
      const blob = await captureMaxQualityPhoto(videoRef.current, {
        applyAntiGlareFilter: true,
        enhanceOCR: true,
        quality: 0.98,
      });

      // Play shutter sound
      playShutterBeep();

      const file = new File([blob], "binder-scan.jpg", { type: "image/jpeg" });
      stopCamera();
      processBinderPage(file);
    } catch (error) {
      console.error('Capture error:', error);
      toast.error('Failed to capture photo');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // Render grid overlay for camera preview
  const renderGridOverlay = () => {
    const cellWidth = 100 / columns;
    const cellHeight = 100 / rows;

    return (
      <div className="absolute inset-0 pointer-events-none">
        {/* Grid lines */}
        {Array.from({ length: columns - 1 }).map((_, i) => (
          <div
            key={`v-${i}`}
            className="absolute top-0 bottom-0 w-0.5 bg-primary/60"
            style={{ left: `${(i + 1) * cellWidth}%` }}
          />
        ))}
        {Array.from({ length: rows - 1 }).map((_, i) => (
          <div
            key={`h-${i}`}
            className="absolute left-0 right-0 h-0.5 bg-primary/60"
            style={{ top: `${(i + 1) * cellHeight}%` }}
          />
        ))}

        {/* Corner markers for each cell */}
        {Array.from({ length: columns * rows }).map((_, i) => {
          const col = i % columns;
          const row = Math.floor(i / columns);
          return (
            <div
              key={`cell-${i}`}
              className="absolute"
              style={{
                left: `${col * cellWidth + 2}%`,
                top: `${row * cellHeight + 2}%`,
                width: `${cellWidth - 4}%`,
                height: `${cellHeight - 4}%`
              }}
            >
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary/80" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary/80" />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary/80" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary/80" />
            </div>
          );
        })}

        {/* Layout indicator */}
        <div className="absolute top-2 left-2 bg-background/80 px-2 py-1 rounded text-xs font-medium">
          {layout} Layout
        </div>
      </div>
    );
  };

  // Render processing visualization
  const renderProcessingView = () => {
    return (
      <div className="space-y-4">
        {/* Preview image with processing overlay */}
        <div className="relative">
          {previewImage && (
            <img
              src={previewImage}
              alt="Binder page"
              className="w-full rounded-lg border border-border opacity-50"
            />
          )}

          {/* Processing cards grid overlay */}
          <div
            className={`absolute inset-0 grid gap-1 p-1 ${
              layout === "3x3" ? "grid-cols-3" :
              layout === "3x4" ? "grid-cols-3" :
              "grid-cols-4"
            }`}
          >
            {processingCards.map((card) => (
              <div
                key={card.index}
                className="relative aspect-[5/7] rounded overflow-hidden border-2 border-border bg-background/80"
              >
                <img
                  src={card.imageUrl}
                  alt={`Card ${card.index + 1}`}
                  className="w-full h-full object-cover"
                />

                {/* Status overlay */}
                <div className={`absolute inset-0 flex flex-col items-center justify-center ${
                  card.status === 'complete' ? 'bg-green-500/20' :
                  card.status === 'error' ? 'bg-red-500/20' :
                  'bg-background/60'
                }`}>
                  {card.status === 'complete' ? (
                    <CheckCircle className="h-6 w-6 text-green-500" />
                  ) : card.status === 'error' ? (
                    <XCircle className="h-6 w-6 text-red-500" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}

                  <span className="text-[10px] mt-1 font-medium text-center px-1">
                    {card.status === 'uploading' && 'Uploading...'}
                    {card.status === 'identifying' && 'Identifying...'}
                    {card.status === 'pricing' && 'Getting prices...'}
                    {card.status === 'saving' && 'Saving...'}
                    {card.status === 'complete' && (card.cardName || 'Done')}
                    {card.status === 'error' && 'Failed'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        <SlotProgress
          total={progress.total}
          processed={progress.processed}
          current={progress.current}
        />
      </div>
    );
  };

  return (
    <Card className="bg-card border-border">
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
                          className="w-full aspect-[5/7] object-cover rounded-lg border-2 border-border group-hover:border-primary/50 transition-colors"
                        />
                      ) : (
                        <div className="w-full aspect-[5/7] bg-secondary rounded-lg border-2 border-border flex items-center justify-center">
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
                          <p className="text-[10px] text-muted-foreground truncate">
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
                    <div className="w-full aspect-[5/7] border-2 border-dashed border-border rounded-lg flex items-center justify-center">
                      <p className="text-xs text-muted-foreground">Empty slot</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : isProcessing ? (
          renderProcessingView()
        ) : (
          <>
            <div>
              <Label>Binder Layout</Label>
              <Select value={layout} onValueChange={(v) => setLayout(v as any)}>
                <SelectTrigger className="bg-secondary border-border">
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
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full"
                  />
                  {renderGridOverlay()}

                  {/* Zoom controls */}
                  {zoomCapabilities.supported && (
                    <ZoomControls
                      zoomLevel={zoomLevel}
                      minZoom={zoomCapabilities.min}
                      maxZoom={zoomCapabilities.max}
                      supported={zoomCapabilities.supported}
                      onZoomIn={zoomIn}
                      onZoomOut={zoomOut}
                      onZoomChange={setZoom}
                      onReset={resetZoom}
                    />
                  )}

                  {/* White Balance */}
                  <WhiteBalanceControl streamRef={streamRef} variant="overlay" />
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Align your binder page with the grid above
                </p>

                <div className="flex gap-2">
                  <Button onClick={capturePhoto} className="flex-1">
                    <Camera className="h-4 w-4 mr-2" />
                    Capture Photo
                  </Button>
                  <Button onClick={stopCamera} variant="outline">
                    <X className="h-4 w-4" />
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
