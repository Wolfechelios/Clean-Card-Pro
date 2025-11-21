import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, SwitchCamera, X, CheckCircle, Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface RapidScanCameraProps {
  userId: string;
  onComplete: () => void;
}

interface CapturedCard {
  id: string;
  blob: Blob;
  preview: string;
  status: 'queued' | 'uploading' | 'processing' | 'completed' | 'error';
  cardName?: string;
  error?: string;
}

const MAX_CAPTURES = 100;

export const RapidScanCamera = ({ userId, onComplete }: RapidScanCameraProps) => {
  const [isActive, setIsActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [captures, setCaptures] = useState<CapturedCard[]>([]);
  const [processing, setProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processingQueueRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);

  const startCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: cameraFacing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        streamRef.current = stream;
        setIsActive(true);
      }
    } catch (error: any) {
      console.error("Camera error:", error);
      if (error.name === 'NotAllowedError') {
        toast.error("Camera permission denied");
      } else {
        toast.error("Failed to access camera");
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsActive(false);
  };

  const toggleCamera = () => {
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(newFacing);
    if (isActive) {
      stopCamera();
      setTimeout(() => startCamera(), 100);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || captures.length >= MAX_CAPTURES) {
      if (captures.length >= MAX_CAPTURES) {
        toast.warning(`Maximum ${MAX_CAPTURES} cards reached`);
      }
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(videoRef.current, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const id = `capture-${Date.now()}-${Math.random()}`;
          const preview = URL.createObjectURL(blob);
          
          const newCapture: CapturedCard = {
            id,
            blob,
            preview,
            status: 'queued',
          };
          
          setCaptures(prev => [...prev, newCapture]);
          processingQueueRef.current.push(id);
          
          // Start background processing if not already running
          if (!isProcessingRef.current) {
            processQueue();
          }
          
          // Haptic feedback on mobile
          if ('vibrate' in navigator) {
            navigator.vibrate(50);
          }
        }
      }, 'image/jpeg', 0.92);
    }
  };

  const togglePause = () => {
    setIsPaused(prev => {
      const newPaused = !prev;
      if (!newPaused && processingQueueRef.current.length > 0) {
        // Resume processing
        toast.info('Processing resumed');
        setTimeout(() => processQueue(), 100);
      } else if (newPaused) {
        toast.info('Processing paused');
      }
      return newPaused;
    });
  };

  const processQueue = async () => {
    if (isProcessingRef.current) {
      return;
    }

    if (isPaused) {
      setProcessing(false);
      return;
    }

    if (processingQueueRef.current.length === 0) {
      setProcessing(false);
      
      // Show completion summary if we just finished processing
      if (captures.length > 0) {
        const completed = captures.filter(c => c.status === 'completed').length;
        const errors = captures.filter(c => c.status === 'error').length;
        const pending = captures.filter(c => c.status === 'queued' || c.status === 'uploading' || c.status === 'processing').length;
        
        if (pending === 0 && (completed > 0 || errors > 0)) {
          toast.success(`Batch complete: ${completed} cards processed${errors > 0 ? `, ${errors} errors` : ''}`);
        }
      }
      return;
    }

    isProcessingRef.current = true;
    setProcessing(true);

    while (processingQueueRef.current.length > 0 && !isPaused) {
      const captureId = processingQueueRef.current[0];
      
      // Get fresh capture from state
      let currentCapture: CapturedCard | undefined;
      setCaptures(prev => {
        currentCapture = prev.find(c => c.id === captureId);
        return prev;
      });
      
      if (!currentCapture) {
        console.warn('Capture not found:', captureId);
        processingQueueRef.current.shift();
        continue;
      }

      try {
        // Update status to uploading
        setCaptures(prev => prev.map(c => 
          c.id === captureId ? { ...c, status: 'uploading' } : c
        ));

        // Upload image
        const fileName = `${userId}/${captureId}.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('card-images')
          .upload(`cards/${fileName}`, currentCapture.blob, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Get signed URL
        const { data: signedUrlData } = await supabase.storage
          .from('card-images')
          .createSignedUrl(`cards/${fileName}`, 31536000);

        if (!signedUrlData?.signedUrl) throw new Error('Failed to get signed URL');

        // Update status to processing
        setCaptures(prev => prev.map(c => 
          c.id === captureId ? { ...c, status: 'processing' } : c
        ));

        // Run card analysis in parallel (don't wait)
        processCardAnalysis(captureId, signedUrlData.signedUrl);

        // Remove from queue immediately, move to next
        processingQueueRef.current.shift();

      } catch (error: any) {
        console.error('Processing error:', error);
        setCaptures(prev => prev.map(c => 
          c.id === captureId ? { ...c, status: 'error', error: error.message } : c
        ));
        processingQueueRef.current.shift();
      }

      // Small delay to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    isProcessingRef.current = false;
    
    // If paused mid-processing, stop here
    if (isPaused) {
      setProcessing(false);
      return;
    }
    
    // Check one more time if queue is truly empty after processing
    if (processingQueueRef.current.length === 0) {
      setProcessing(false);
      
      // Show final summary
      const completed = captures.filter(c => c.status === 'completed').length;
      const errors = captures.filter(c => c.status === 'error').length;
      
      if (completed > 0 || errors > 0) {
        toast.success(`Queue complete: ${completed} cards saved${errors > 0 ? `, ${errors} failed` : ''}`);
      }
    } else {
      // More items were added, continue processing
      isProcessingRef.current = false;
      processQueue();
    }
  };

  const processCardAnalysis = async (captureId: string, imageUrl: string) => {
    try {
      // Run OCR analysis
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke(
        'analyze-card-full',
        { body: { image_url: imageUrl } }
      );

      if (analysisError) throw analysisError;

      const ocrText = analysisData?.vision?.ocr_text || '';

      // Run enhanced identification
      const { data: enhancedData, error: enhancedError } = await supabase.functions.invoke(
        'enhanced-card-identify',
        { body: { imageUrl, ocrText } }
      );

      if (enhancedError) throw enhancedError;

      const cardData = enhancedData?.cardData?.primary || enhancedData?.cardData;

      // Get pricing
      const { data: pricingData } = await supabase.functions.invoke(
        'identify-card',
        { body: { imageUrl, ocrText } }
      );

      // Save to database
      await supabase.from('cards').insert({
        user_id: userId,
        card_name: cardData?.card_name || 'Unknown Card',
        card_set: cardData?.card_set,
        card_number: cardData?.card_number,
        rarity: cardData?.rarity,
        edition: cardData?.edition,
        game_type: cardData?.game_type,
        sport_type: cardData?.sport_type,
        image_url: imageUrl,
        thumbnail_url: imageUrl,
        ocr_raw_text: ocrText,
        ocr_confidence: cardData?.confidence || 0,
        current_price_raw: pricingData?.pricing?.currentPriceRaw,
        current_price_psa9: pricingData?.pricing?.currentPricePsa9,
        current_price_psa10: pricingData?.pricing?.currentPricePsa10,
        suggested_price: pricingData?.pricing?.suggestedPrice,
        last_price_update: new Date().toISOString(),
      });

      // Update status to completed
      setCaptures(prev => prev.map(c => 
        c.id === captureId ? { 
          ...c, 
          status: 'completed', 
          cardName: cardData?.card_name 
        } : c
      ));

    } catch (error: any) {
      console.error('Card analysis error:', error);
      setCaptures(prev => prev.map(c => 
        c.id === captureId ? { ...c, status: 'error', error: error.message } : c
      ));
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    // Auto-process queue when captures are added (unless paused)
    if (captures.length > 0 && !isProcessingRef.current && processingQueueRef.current.length > 0 && !isPaused) {
      processQueue();
    }
  }, [captures.length, isPaused]);

  const completedCount = captures.filter(c => c.status === 'completed').length;
  const errorCount = captures.filter(c => c.status === 'error').length;
  const processingCount = captures.filter(c => c.status === 'processing').length;
  const uploadingCount = captures.filter(c => c.status === 'uploading').length;
  const queuedCount = captures.filter(c => c.status === 'queued').length;
  const progress = captures.length > 0 ? (completedCount / captures.length) * 100 : 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Rapid Scan Mode</span>
          <Badge variant={processing ? "default" : "secondary"}>
            {captures.length}/{MAX_CAPTURES} captured
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Camera View */}
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          
          {/* Camera Controls Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCamera}
                className="text-white"
              >
                <SwitchCamera className="h-6 w-6" />
              </Button>
              
              <Button
                size="lg"
                onClick={capturePhoto}
                disabled={captures.length >= MAX_CAPTURES}
                className="rounded-full h-16 w-16"
              >
                <Camera className="h-8 w-8" />
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  stopCamera();
                  onComplete();
                }}
                className="text-white"
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>

        {/* Progress */}
        {captures.length > 0 && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex gap-4 text-sm">
                <span className="text-green-500">✓ {completedCount}</span>
                {processingCount > 0 && <span className="text-blue-500">⏳ {processingCount}</span>}
                {uploadingCount > 0 && <span className="text-yellow-500">⬆ {uploadingCount}</span>}
                {queuedCount > 0 && <span className="text-muted-foreground">⏸ {queuedCount}</span>}
                {errorCount > 0 && <span className="text-red-500">✗ {errorCount}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{Math.round(progress)}%</span>
                {queuedCount > 0 && (
                  <Button
                    size="sm"
                    variant={isPaused ? "default" : "outline"}
                    onClick={togglePause}
                    className="h-8"
                  >
                    {isPaused ? (
                      <>
                        <Play className="h-3 w-3 mr-1" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-3 w-3 mr-1" />
                        Pause
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progress} className="h-2" />
            {isPaused && queuedCount > 0 && (
              <p className="text-xs text-muted-foreground text-center">
                Processing paused - {queuedCount} cards waiting
              </p>
            )}
          </div>
        )}

        {/* Capture Grid */}
        {captures.length > 0 && (
          <ScrollArea className="h-48">
            <div className="grid grid-cols-4 gap-2">
              {captures.map((capture) => (
                <div key={capture.id} className="relative aspect-square rounded-md overflow-hidden border">
                  <img 
                    src={capture.preview} 
                    alt="Captured card"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    {capture.status === 'completed' && (
                      <CheckCircle className="h-6 w-6 text-green-500" />
                    )}
                    {(capture.status === 'uploading' || capture.status === 'processing' || capture.status === 'queued') && (
                      <Loader2 className="h-6 w-6 text-white animate-spin" />
                    )}
                    {capture.status === 'error' && (
                      <X className="h-6 w-6 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <p className="text-sm text-muted-foreground text-center">
          Tap the camera button to capture. Processing happens automatically in the background.
        </p>
      </CardContent>
    </Card>
  );
};
