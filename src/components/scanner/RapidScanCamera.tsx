import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, SwitchCamera, X, CheckCircle, Loader2, Pause, Play, Focus } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";

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
  const capturesRef = useRef<CapturedCard[]>([]);

  const { devices, selectedDeviceId, setSelectedDeviceId, isLoading: devicesLoading, refreshDevices } = useCameraDevices();

  const startCamera = async (deviceId?: string) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const targetDeviceId = deviceId || selectedDeviceId;
      
      // Build constraints - prefer specific device if selected
      const constraints: MediaStreamConstraints = targetDeviceId ? {
        video: {
          deviceId: { exact: targetDeviceId },
          width: { ideal: 3840, min: 1920 },
          height: { ideal: 2160, min: 1080 },
          aspectRatio: { ideal: 5/7 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      } : {
        video: {
          facingMode: { ideal: cameraFacing },
          width: { ideal: 3840, min: 1920 },
          height: { ideal: 2160, min: 1080 },
          aspectRatio: { ideal: 5/7 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

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

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (isActive) {
      stopCamera();
      setTimeout(() => startCamera(deviceId), 100);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || captures.length >= MAX_CAPTURES) {
      if (captures.length >= MAX_CAPTURES) {
        toast.warning(`Maximum ${MAX_CAPTURES} cards reached`);
      }
      return;
    }

    const video = videoRef.current;
    
    // Validate video is actually streaming
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      toast.error('Camera not ready. Please wait for video to load.');
      return;
    }

    const canvas = document.createElement('canvas');
    
    // Use high resolution for capture
    const captureWidth = Math.max(video.videoWidth, 2560);
    const captureHeight = Math.max(video.videoHeight, 3584); // 5:7 ratio
    
    canvas.width = captureWidth;
    canvas.height = captureHeight;
    
    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false
    });
    
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Calculate scaling to maintain aspect ratio
      const videoRatio = video.videoWidth / video.videoHeight;
      const targetRatio = 5 / 7;
      
      let drawWidth = video.videoWidth;
      let drawHeight = video.videoHeight;
      let offsetX = 0;
      let offsetY = 0;
      
      if (videoRatio > targetRatio) {
        // Video is wider, crop sides
        drawWidth = video.videoHeight * targetRatio;
        offsetX = (video.videoWidth - drawWidth) / 2;
      } else {
        // Video is taller, crop top/bottom
        drawHeight = video.videoWidth / targetRatio;
        offsetY = (video.videoHeight - drawHeight) / 2;
      }
      
      // Fill background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw cropped and scaled video
      ctx.drawImage(
        video,
        offsetX, offsetY, drawWidth, drawHeight,
        0, 0, canvas.width, canvas.height
      );
      
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
          
          setCaptures(prev => {
            const updated = [...prev, newCapture];
            capturesRef.current = updated;
            return updated;
          });
          processingQueueRef.current.push(id);
          
          // Start background processing if not already running
          if (!isProcessingRef.current) {
            processQueue();
          }
          
          // Haptic feedback on mobile
          if ('vibrate' in navigator) {
            navigator.vibrate(50);
          }
          
          toast.success('Card captured!');
        }
      }, 'image/jpeg', 0.98);
    }
  };

  const togglePause = () => {
    setIsPaused(prev => {
      const newPaused = !prev;
      if (!newPaused && processingQueueRef.current.length > 0) {
        toast.info('Processing resumed');
        setTimeout(() => processQueue(), 100);
      } else if (newPaused) {
        toast.info('Processing paused');
      }
      return newPaused;
    });
  };

  const CONCURRENT_LIMIT = 5; // Process 5 cards at a time

  const processSingleCard = async (captureId: string, blob: Blob): Promise<void> => {
    try {
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'uploading' as const } : c);
        capturesRef.current = updated;
        return updated;
      });

      const fileName = `${userId}/${captureId}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('card-images')
        .upload(`cards/${fileName}`, blob, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: signedUrlData } = await supabase.storage
        .from('card-images')
        .createSignedUrl(`cards/${fileName}`, 31536000);

      if (!signedUrlData?.signedUrl) throw new Error('Failed to get signed URL');

      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'processing' as const } : c);
        capturesRef.current = updated;
        return updated;
      });

      await processCardAnalysis(captureId, signedUrlData.signedUrl);

    } catch (error: any) {
      console.error('Processing error:', error);
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'error' as const, error: error.message } : c);
        capturesRef.current = updated;
        return updated;
      });
    }
  };

  const processQueue = async () => {
    if (isProcessingRef.current) return;
    if (isPaused) {
      setProcessing(false);
      return;
    }

    if (processingQueueRef.current.length === 0) {
      setProcessing(false);
      return;
    }

    isProcessingRef.current = true;
    setProcessing(true);

    while (processingQueueRef.current.length > 0 && !isPaused) {
      // Get next batch of cards to process concurrently
      const batchIds = processingQueueRef.current.slice(0, CONCURRENT_LIMIT);
      
      // Get blob data for each card in batch from ref (synchronous read)
      const batchItems: { id: string; blob: Blob }[] = [];
      for (const id of batchIds) {
        const capture = capturesRef.current.find(c => c.id === id);
        if (capture) {
          batchItems.push({ id, blob: capture.blob });
        }
      }

      // Remove batch from queue
      processingQueueRef.current = processingQueueRef.current.slice(batchIds.length);

      // Process batch concurrently
      await Promise.all(
        batchItems.map(item => processSingleCard(item.id, item.blob))
      );
    }

    isProcessingRef.current = false;
    setProcessing(false);
    
    if (!isPaused) {
      const completed = capturesRef.current.filter(c => c.status === 'completed').length;
      const errors = capturesRef.current.filter(c => c.status === 'error').length;
      
      if (completed > 0 || errors > 0) {
        toast.success(`Complete: ${completed} cards saved${errors > 0 ? `, ${errors} failed` : ''}`);
      }
    }
  };

  const processCardAnalysis = async (captureId: string, imageUrl: string) => {
    try {
      // Run identification and pricing in parallel for speed
      const [identifyResult, pricingResult] = await Promise.all([
        supabase.functions.invoke('enhanced-card-identify', { 
          body: { imageUrl } 
        }),
        supabase.functions.invoke('fetch-card-prices', { 
          body: { imageUrl } 
        }).catch(() => ({ data: null })) // Don't fail if pricing fails
      ]);

      if (identifyResult.error) throw identifyResult.error;

      const cardData = identifyResult.data?.cardData?.primary || identifyResult.data?.cardData;
      const pricingData = pricingResult.data;

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
        ocr_raw_text: cardData?.description || '',
        ocr_confidence: cardData?.confidence || 0,
        current_price_raw: pricingData?.pricing?.currentPriceRaw,
        current_price_psa9: pricingData?.pricing?.currentPricePsa9,
        current_price_psa10: pricingData?.pricing?.currentPricePsa10,
        suggested_price: pricingData?.pricing?.suggestedPrice,
        last_price_update: new Date().toISOString(),
      });

      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { 
          ...c, 
          status: 'completed' as const, 
          cardName: cardData?.card_name 
        } : c);
        capturesRef.current = updated;
        return updated;
      });

    } catch (error: any) {
      console.error('Card analysis error:', error);
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'error' as const, error: error.message } : c);
        capturesRef.current = updated;
        return updated;
      });
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  useEffect(() => {
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
    <div className="w-full max-w-4xl mx-auto space-y-4">
      {/* Header Stats */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="text-2xl font-bold">Rapid Scan</h3>
              <p className="text-sm text-muted-foreground">
                Capture cards quickly - processing happens automatically
              </p>
            </div>
            <Badge variant={processing ? "default" : "secondary"} className="text-lg px-4 py-2">
              {captures.length}/{MAX_CAPTURES}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Camera Viewfinder */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Device Selector */}
          {devices.length > 1 && (
            <div className="p-4 border-b bg-background/80">
              <CameraDeviceSelector
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                onDeviceChange={handleDeviceChange}
                onRefresh={refreshDevices}
                isLoading={devicesLoading}
              />
            </div>
          )}
          
          <div className="relative bg-black">
            {/* Video container with trading card aspect ratio */}
            <div className="relative mx-auto max-w-md" style={{ aspectRatio: '5/7' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              
              {/* Trading Card Guide Overlay */}
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner guides */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 140" preserveAspectRatio="none">
                  {/* Top-left corner */}
                  <path d="M 10 10 L 10 20 M 10 10 L 20 10" stroke="white" strokeWidth="0.5" fill="none" opacity="0.8"/>
                  {/* Top-right corner */}
                  <path d="M 90 10 L 90 20 M 90 10 L 80 10" stroke="white" strokeWidth="0.5" fill="none" opacity="0.8"/>
                  {/* Bottom-left corner */}
                  <path d="M 10 130 L 10 120 M 10 130 L 20 130" stroke="white" strokeWidth="0.5" fill="none" opacity="0.8"/>
                  {/* Bottom-right corner */}
                  <path d="M 90 130 L 90 120 M 90 130 L 80 130" stroke="white" strokeWidth="0.5" fill="none" opacity="0.8"/>
                  
                  {/* Center alignment guides */}
                  <line x1="50" y1="0" x2="50" y2="10" stroke="white" strokeWidth="0.3" opacity="0.5" strokeDasharray="1,2"/>
                  <line x1="50" y1="130" x2="50" y2="140" stroke="white" strokeWidth="0.3" opacity="0.5" strokeDasharray="1,2"/>
                </svg>
                
                {/* Instruction overlay */}
                <div className="absolute top-4 left-0 right-0 text-center">
                  <div className="inline-flex items-center gap-2 bg-black/70 backdrop-blur-sm px-4 py-2 rounded-full">
                    <Focus className="h-4 w-4 text-white" />
                    <span className="text-white text-sm font-medium">Align card with guides</span>
                  </div>
                </div>
              </div>

              {/* Camera Controls */}
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black/80 to-transparent">
                <div className="flex items-center justify-center gap-4 max-w-2xl mx-auto">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleCamera}
                    className="text-white hover:bg-white/20 h-12 w-12"
                  >
                    <SwitchCamera className="h-6 w-6" />
                  </Button>
                  
                  <Button
                    size="lg"
                    onClick={capturePhoto}
                    disabled={captures.length >= MAX_CAPTURES}
                    className="rounded-full h-20 w-20 shadow-2xl"
                  >
                    <Camera className="h-10 w-10" />
                  </Button>

                  {captures.length > 0 && (
                    <Button
                      size="lg"
                      onClick={() => {
                        if (processingQueueRef.current.length > 0 || queuedCount > 0) {
                          setIsPaused(false);
                          toast.success('Processing all captured cards...');
                          processQueue();
                        }
                        stopCamera();
                        setTimeout(() => onComplete(), 500);
                      }}
                      className="bg-green-600 hover:bg-green-700 text-white h-14 px-8 font-semibold"
                    >
                      Done ({captures.length})
                    </Button>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      stopCamera();
                      onComplete();
                    }}
                    className="text-white hover:bg-white/20 h-12 w-12"
                  >
                    <X className="h-6 w-6" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress Section */}
      {captures.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-6 text-sm font-medium">
                <span className="text-green-500 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  {completedCount}
                </span>
                {processingCount > 0 && (
                  <span className="text-blue-500 flex items-center gap-1">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {processingCount}
                  </span>
                )}
                {uploadingCount > 0 && (
                  <span className="text-yellow-500 flex items-center gap-1">
                    ⬆ {uploadingCount}
                  </span>
                )}
                {queuedCount > 0 && (
                  <span className="text-muted-foreground flex items-center gap-1">
                    ⏸ {queuedCount}
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-red-500 flex items-center gap-1">
                    <X className="h-4 w-4" />
                    {errorCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold tabular-nums">{Math.round(progress)}%</span>
                {queuedCount > 0 && (
                  <Button
                    size="sm"
                    variant={isPaused ? "default" : "outline"}
                    onClick={togglePause}
                  >
                    {isPaused ? (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4 mr-2" />
                        Pause
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progress} className="h-3" />
            {isPaused && queuedCount > 0 && (
              <p className="text-sm text-muted-foreground text-center">
                ⏸ Processing paused - {queuedCount} cards waiting in queue
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Capture Grid */}
      {captures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Captured Cards</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {captures.map((capture) => (
                  <div 
                    key={capture.id} 
                    className="relative rounded-lg overflow-hidden border-2 transition-all"
                    style={{ aspectRatio: '5/7' }}
                  >
                    <img 
                      src={capture.preview} 
                      alt="Captured card"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      {capture.status === 'completed' && (
                        <div className="flex flex-col items-center gap-1">
                          <CheckCircle className="h-8 w-8 text-green-500" />
                          {capture.cardName && (
                            <span className="text-xs text-white text-center px-1 line-clamp-2">
                              {capture.cardName}
                            </span>
                          )}
                        </div>
                      )}
                      {(capture.status === 'uploading' || capture.status === 'processing' || capture.status === 'queued') && (
                        <Loader2 className="h-8 w-8 text-white animate-spin" />
                      )}
                      {capture.status === 'error' && (
                        <X className="h-8 w-8 text-red-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
};