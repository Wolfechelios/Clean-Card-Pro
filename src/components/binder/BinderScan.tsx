import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Camera, Grid3x3 } from "lucide-react";
import { SlotProgress } from "./SlotProgress";
import { detectCardRegions, extractCardImage } from "@/lib/binder/preprocess";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BinderScanProps {
  binderName: string;
  onComplete: () => void;
}

export function BinderScan({ binderName, onComplete }: BinderScanProps) {
  const [layout, setLayout] = useState<"3x3" | "3x4" | "4x3">("3x3");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ total: 0, processed: 0, current: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const getLayoutDimensions = (layout: string) => {
    const [cols, rows] = layout.split("x").map(Number);
    return { columns: cols, rows };
  };

  const processBinderPage = async (imageFile: File) => {
    setIsProcessing(true);
    const { columns, rows } = getLayoutDimensions(layout);
    const totalCards = columns * rows;
    let imageUrl = "";

    try {
      // Load image
      const img = new Image();
      imageUrl = URL.createObjectURL(imageFile);
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });

      // Create canvas and get image data
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Detect card regions
      const regions = await detectCardRegions(imageData, columns, rows);
      setProgress({ total: totalCards, processed: 0, current: "" });

      // Get user session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Process each card region
      for (let i = 0; i < regions.length; i++) {
        setProgress({ total: totalCards, processed: i, current: `Card ${i + 1}` });

        const region = regions[i];
        const cardImageData = extractCardImage(canvas, region);

        // Convert data URL to blob
        const response = await fetch(cardImageData);
        const blob = await response.blob();

        // Upload to storage
        const fileName = `binder-${Date.now()}-${i}.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("card-images")
          .upload(fileName, blob);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from("card-images")
          .getPublicUrl(fileName);

        // Call edge function to identify card
        const { data: cardData, error: identifyError } = await supabase.functions
          .invoke("identify-card", {
            body: { imageUrl: publicUrl },
          });

        if (!identifyError && cardData) {
          // Save card to database
          await supabase.from("cards").insert({
            user_id: session.user.id,
            card_name: cardData.cardName || "Unknown Card",
            card_set: cardData.setName,
            card_number: cardData.cardNumber,
            rarity: cardData.rarity,
            image_url: publicUrl,
            thumbnail_url: publicUrl,
            collection_name: binderName,
            ocr_raw_text: cardData.rawText,
          });
        }
      }

      toast.success(`Successfully scanned ${totalCards} cards!`);
      onComplete();
    } catch (error) {
      console.error("Error processing binder page:", error);
      toast.error("Failed to process binder page");
    } finally {
      setIsProcessing(false);
      URL.revokeObjectURL(imageUrl);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processBinderPage(file);
    }
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
        {isProcessing ? (
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
                    Capture
                  </Button>
                  <Button onClick={stopCamera} variant="outline">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Image
                </Button>
                <Button onClick={startCamera} variant="outline">
                  <Camera className="mr-2 h-4 w-4" />
                  Use Camera
                </Button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
