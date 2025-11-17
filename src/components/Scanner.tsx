import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Upload, Camera, Loader2, CheckCircle, X, RefreshCw, FolderUp } from "lucide-react";
import { createWorker } from "tesseract.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchProgress } from "./scanner/BatchProgress";
import { CardIdentificationEditor } from "./scanner/CardIdentificationEditor";

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

interface ScanJob {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'scanning' | 'complete' | 'error';
  result?: OCRResult;
  error?: string;
}

interface IdentifiedCard {
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

interface Alternative {
  card_name: string;
  card_set: string;
  confidence: number;
  reason: string;
}

interface PendingCardData {
  identifiedCard: IdentifiedCard;
  alternatives: Alternative[];
  imageUrl: string;
  fallbackData?: any;
}

const Scanner = ({ userId }: ScannerProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [batchCards, setBatchCards] = useState<Array<{
    id: string;
    fileName: string;
    status: "pending" | "processing" | "completed" | "error";
    error?: string;
    cardName?: string;
  }>>([]);
  const [pendingCard, setPendingCard] = useState<PendingCardData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      
      // Check total size
      const totalSize = fileArray.reduce((sum, f) => sum + f.size, 0);
      const maxSize = 500 * 1024 * 1024; // 500MB
      
      if (totalSize > maxSize) {
        toast.error(`Total file size exceeds 500MB limit`);
        return;
      }

      if (fileArray.length === 1) {
        // Single file - use existing flow
        const selectedFile = fileArray[0];
        setFile(selectedFile);
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreview(e.target?.result as string);
        };
        reader.readAsDataURL(selectedFile);
        setOcrResult(null);
      } else {
        // Multiple files - use batch mode
        processBatchFiles(fileArray);
      }
    }
  };

  const processBatchFiles = (files: File[]) => {
    const jobs: ScanJob[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      preview: '',
      status: 'pending' as const
    }));

    // Create previews
    jobs.forEach(job => {
      const reader = new FileReader();
      reader.onload = (e) => {
        job.preview = e.target?.result as string;
        setScanJobs(prev => [...prev.filter(j => j.id !== job.id), job]);
      };
      reader.readAsDataURL(job.file);
    });

    setScanJobs(jobs);
    toast.success(`Added ${files.length} files to batch queue`);
  };

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    
    if (files.length === 0) {
      toast.error("Please drop image files only");
      return;
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const maxSize = 500 * 1024 * 1024;
    
    if (totalSize > maxSize) {
      toast.error(`Total file size exceeds 500MB limit`);
      return;
    }

    if (files.length === 1) {
      setFile(files[0]);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(files[0]);
      setOcrResult(null);
    } else {
      processBatchFiles(files);
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
      setScanProgress(50);

      // Upload image to Supabase Storage
      const fileExt = file.name.split(".").pop();
      const cardId = crypto.randomUUID();
      const fileName = `cards/${cardId}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("card-images")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: signedUrlData, error: urlError } = await supabase.storage
        .from("card-images")
        .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year

      if (urlError) throw urlError;
      const imageUrl = signedUrlData.signedUrl;

      setScanProgress(60);

      // Call enhanced AI identification with Lovable AI
      toast.info("Identifying card with enhanced AI...");
      
      let enhancedData;
      let alternatives: Alternative[] = [];
      try {
        const enhancedRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhanced-card-identify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageUrl: imageUrl,
              ocrText: ocr.rawText,
            }),
          }
        );
        
        if (enhancedRes.ok) {
          const enhancedResult = await enhancedRes.json();
          if (enhancedResult.success) {
            const cardData = enhancedResult.cardData;
            // Handle new format with primary and alternatives
            if (cardData.primary) {
              enhancedData = cardData.primary;
              alternatives = cardData.alternatives || [];
            } else {
              // Handle old format for backward compatibility
              enhancedData = cardData;
            }
            toast.success(`Card identified: ${enhancedData.card_name}`);
          }
        }
      } catch (error) {
        console.error("Enhanced identification error:", error);
        toast.warning("Using fallback identification...");
      }

      setScanProgress(70);

      // Fallback to original identification if enhanced fails
      let fallbackData;
      if (!enhancedData) {
        const { data: cardIdentification, error: aiError } = await supabase.functions.invoke(
          "identify-card",
          {
            body: {
              imageUrl: imageUrl,
              ocrText: ocr.rawText,
            },
          }
        );

        if (aiError) {
          console.error("AI identification error:", aiError);
          throw new Error("Failed to identify card details");
        }
        fallbackData = cardIdentification;
      }

      setScanProgress(90);

      // Show editor instead of saving immediately
      const identifiedCard: IdentifiedCard = enhancedData || {
        card_name: fallbackData?.cardName || ocr.cardName,
        card_set: fallbackData?.cardSet || ocr.cardSet,
        card_number: fallbackData?.cardNumber || ocr.cardNumber,
        rarity: fallbackData?.rarity || null,
        edition: fallbackData?.edition || null,
        game_type: fallbackData?.gameType || null,
        sport_type: fallbackData?.sportType || null,
        year: fallbackData?.year || null,
        manufacturer: fallbackData?.manufacturer || null,
        confidence: enhancedData?.confidence || fallbackData?.confidence || ocr.confidence,
        description: fallbackData?.notes || "",
      };

      setPendingCard({
        identifiedCard,
        alternatives,
        imageUrl,
        fallbackData,
      });

      setScanProgress(100);
      setIsScanning(false);
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
    setPendingCard(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleConfirmCard = async (editedCard: IdentifiedCard) => {
    if (!pendingCard) return;

    try {
      const { error: dbError } = await supabase.from("cards").insert({
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

      if (dbError) throw dbError;

      toast.success("Card saved successfully!");
      
      // Reset form
      setFile(null);
      setPreview(null);
      setOcrResult(null);
      setScanProgress(0);
      setPendingCard(null);
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(error.message || "Error saving card");
    }
  };

  const handleCancelCard = () => {
    setPendingCard(null);
    toast.info("Card identification cancelled");
  };

  const handleSelectAlternative = (alternative: Alternative) => {
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
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' },
        audio: false 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraActive(true);
      }
    } catch (error) {
      console.error('Camera access error:', error);
      toast.error('Could not access camera');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
          setFile(file);
          const reader = new FileReader();
          reader.onload = (e) => {
            setPreview(e.target?.result as string);
          };
          reader.readAsDataURL(file);
          setOcrResult(null);
          stopCamera();
        }
      }, 'image/jpeg', 0.95);
    }
  };

  const processBatchQueue = async () => {
    const pendingJobs = scanJobs.filter(j => j.status === 'pending');
    
    // Initialize batch cards for progress tracking
    const initialCards = pendingJobs.map((job) => ({
      id: job.id,
      fileName: job.file.name,
      status: "pending" as const,
    }));
    setBatchCards(initialCards);
    
    for (const job of pendingJobs) {
      // Update to processing
      setBatchCards(prev => prev.map(c => 
        c.id === job.id ? { ...c, status: "processing" as const } : c
      ));
      
      setScanJobs(prev => prev.map(j => 
        j.id === job.id ? { ...j, status: 'scanning' as const } : j
      ));

      try {
        const ocr = await performOCR(job.file);
        
        const fileExt = job.file.name.split(".").pop();
        const cardId = crypto.randomUUID();
        const fileName = `cards/${cardId}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("card-images")
          .upload(fileName, job.file);

        if (uploadError) throw uploadError;

        const { data: signedUrlData, error: urlError } = await supabase.storage
          .from("card-images")
          .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year

        if (urlError) throw urlError;
        const imageUrl = signedUrlData.signedUrl;

        // Try enhanced AI identification first
        let cardIdentification;
        try {
          const enhancedRes = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhanced-card-identify`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageUrl: imageUrl,
                ocrText: ocr.rawText,
              }),
            }
          );
          
          if (enhancedRes.ok) {
            const enhancedResult = await enhancedRes.json();
            if (enhancedResult.success) {
              cardIdentification = enhancedResult.cardData;
            }
          }
        } catch (error) {
          console.error("Enhanced identification error:", error);
        }

        // Fallback to standard identification
        if (!cardIdentification) {
          const { data, error: aiError } = await supabase.functions.invoke(
            "identify-card",
            {
              body: {
                imageUrl: imageUrl,
                ocrText: ocr.rawText,
              },
            }
          );
          if (aiError) throw aiError;
          cardIdentification = data;
        }

        await supabase.from("cards").insert({
          user_id: userId,
          card_name: cardIdentification.card_name || cardIdentification.cardName || ocr.cardName,
          card_set: cardIdentification.card_set || cardIdentification.cardSet || ocr.cardSet,
          card_number: cardIdentification.card_number || cardIdentification.cardNumber || ocr.cardNumber,
          rarity: cardIdentification.rarity,
          edition: cardIdentification.edition,
          condition: cardIdentification.condition || "ungraded",
          sport_type: cardIdentification.sport_type || cardIdentification.sportType,
          game_type: cardIdentification.game_type || cardIdentification.gameType,
          notes: cardIdentification.description || cardIdentification.notes,
          ocr_confidence: cardIdentification.confidence || ocr.confidence,
          ocr_raw_text: ocr.rawText,
          current_price_raw: cardIdentification.currentPriceRaw,
          current_price_psa9: cardIdentification.currentPricePsa9,
          current_price_psa10: cardIdentification.currentPricePsa10,
          suggested_price: cardIdentification.suggestedPrice,
          ebay_listing_url: cardIdentification.ebayListingUrl,
          image_url: imageUrl,
          thumbnail_url: imageUrl,
          last_price_update: new Date().toISOString(),
        });

        // Update to completed
        setBatchCards(prev => prev.map(c => 
          c.id === job.id ? { 
            ...c, 
            status: "completed" as const,
            cardName: cardIdentification.card_name || cardIdentification.cardName || ocr.cardName || "Unknown Card"
          } : c
        ));

        setScanJobs(prev => prev.map(j => 
          j.id === job.id ? { ...j, status: 'complete' as const, result: ocr } : j
        ));
      } catch (error: any) {
        console.error('Batch scan error:', error);
        
        // Update to error
        setBatchCards(prev => prev.map(c => 
          c.id === job.id ? { 
            ...c, 
            status: "error" as const,
            error: error.message || "Failed to process"
          } : c
        ));
        
        setScanJobs(prev => prev.map(j => 
          j.id === job.id ? { ...j, status: 'error' as const, error: error.message } : j
        ));
      }
    }

    toast.success('Batch processing complete!');
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="camera">Camera</TabsTrigger>
        </TabsList>
        
        <TabsContent value="upload">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Upload Section */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Upload Card Image(s)</CardTitle>
                <CardDescription>
                  Drag and drop or click to select (up to 500MB total)
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
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    accept="image/*"
                    {...({ webkitdirectory: "", directory: "" } as any)}
                    multiple
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
                  <p className="font-medium">Drop your card images here</p>
                  <p className="text-sm text-muted-foreground">or use the buttons below to select files or folders</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Select Files
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                  >
                    <FolderUp className="mr-2 h-4 w-4" />
                    Select Folder
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Supports JPG, PNG, WEBP up to 500MB total
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleScan}
              disabled={!file || isScanning}
              className="flex-1"
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
            
            {ocrResult && (
              <Button
                onClick={() => {
                  setOcrResult(null);
                  handleScan();
                }}
                disabled={isScanning}
                variant="outline"
                size="lg"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Rescan
              </Button>
            )}
          </div>

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

      {/* Batch Progress */}
      {batchCards.length > 0 && (
        <BatchProgress
          cards={batchCards}
          total={batchCards.length}
          completed={batchCards.filter(c => c.status === "completed").length}
        />
      )}

      {/* Results Section */}
      {pendingCard ? (
        <CardIdentificationEditor
          primaryCard={pendingCard.identifiedCard}
          alternatives={pendingCard.alternatives}
          imageUrl={preview || undefined}
          onConfirm={handleConfirmCard}
          onSelectAlternative={handleSelectAlternative}
          onCancel={handleCancelCard}
        />
      ) : (
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
      )}
    </div>
  </TabsContent>

  <TabsContent value="camera">
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Camera Capture</CardTitle>
        <CardDescription>
          Use your device camera to capture card images
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isCameraActive ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
            <div className="rounded-full bg-primary/10 p-6">
              <Camera className="h-12 w-12 text-primary" />
            </div>
            <Button onClick={startCamera} size="lg">
              <Camera className="mr-2 h-4 w-4" />
              Start Camera
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full rounded-lg"
            />
            <div className="flex gap-2">
              <Button onClick={capturePhoto} size="lg" className="flex-1">
                <Camera className="mr-2 h-4 w-4" />
                Capture Photo
              </Button>
              <Button onClick={stopCamera} variant="outline" size="lg">
                <X className="mr-2 h-4 w-4" />
                Close Camera
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  </TabsContent>
</Tabs>

{scanJobs.length > 0 && (
  <Card className="shadow-card">
    <CardHeader>
      <CardTitle>Batch Queue ({scanJobs.length} files)</CardTitle>
      <CardDescription>Process multiple cards at once</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-2 max-h-[400px] overflow-y-auto">
        {scanJobs.map(job => (
          <div key={job.id} className="flex items-center gap-3 rounded-lg border p-3">
            <img src={job.preview} alt="" className="h-12 w-12 rounded object-cover" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{job.file.name}</p>
              <p className="text-xs text-muted-foreground">
                {job.status === 'pending' && 'Waiting...'}
                {job.status === 'scanning' && 'Scanning...'}
                {job.status === 'complete' && '✓ Complete'}
                {job.status === 'error' && `Error: ${job.error}`}
              </p>
            </div>
            {job.status === 'scanning' && <Loader2 className="h-4 w-4 animate-spin" />}
            {job.status === 'complete' && <CheckCircle className="h-4 w-4 text-success" />}
          </div>
        ))}
      </div>
      <Button 
        onClick={processBatchQueue} 
        disabled={scanJobs.every(j => j.status !== 'pending')}
        className="w-full"
        size="lg"
      >
        <FolderUp className="mr-2 h-4 w-4" />
        Process All ({scanJobs.filter(j => j.status === 'pending').length} pending)
      </Button>
    </CardContent>
  </Card>
)}
</div>
  );
};

export default Scanner;
