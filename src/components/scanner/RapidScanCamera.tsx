import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, SwitchCamera, X, CheckCircle, Loader2, Pause, Play, Zap, Usb, Smartphone, RefreshCw, DollarSign, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";
import { ScannedCardList } from "./ScannedCardList";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCameraZoom } from "@/hooks/use-camera-zoom";
import { ZoomControls } from "./ZoomControls";
import { isNativePlatform } from "@/lib/platform";
import { 
  getMaxCameraConstraints, 
  applyFastAutofocus, 
  triggerFastFocus,
  captureMaxQualityPhoto,
  applyAntiGlare
} from "@/lib/camera-optimizations";

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
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  value?: number | null;
  error?: string;
  dbId?: string;
  priceFetching?: boolean;
}

const MAX_CAPTURES = 100;

export const RapidScanCamera = ({ userId, onComplete }: RapidScanCameraProps) => {
  const [isActive, setIsActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraMode, setCameraMode] = useState<'device' | 'usb'>('device');
  const [captures, setCaptures] = useState<CapturedCard[]>([]);
  const [processing, setProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [flashSupported, setFlashSupported] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processingQueueRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);
  const capturesRef = useRef<CapturedCard[]>([]);
  const shutterSoundRef = useRef<HTMLAudioElement | null>(null);
  const errorSoundRef = useRef<HTMLAudioElement | null>(null);

  // Initialize sounds
  useEffect(() => {
    shutterSoundRef.current = new Audio('/sounds/shutter.mp3');
    shutterSoundRef.current.volume = 0.5;
    errorSoundRef.current = new Audio('/sounds/error.mp3');
    errorSoundRef.current.volume = 0.6;
    return () => {
      shutterSoundRef.current = null;
      errorSoundRef.current = null;
    };
  }, []);

  const { devices, selectedDeviceId, setSelectedDeviceId, isLoading: devicesLoading, refreshDevices } = useCameraDevices();
  
  // Zoom controls
  const { zoomLevel, zoomCapabilities, detectZoomCapabilities, setZoom, zoomIn, zoomOut, resetZoom } = useCameraZoom({
    streamRef,
  });
  
  // Filter USB vs regular devices
  const usbDevices = devices.filter(d => d.isUSB);
  const regularDevices = devices.filter(d => !d.isUSB);
  const hasUSBDevices = usbDevices.length > 0;

  const startCamera = async (deviceId?: string) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const targetDeviceId = deviceId || selectedDeviceId;
      const isUSBMode = cameraMode === 'usb';

      // Use maximum quality camera constraints (8K/4K support)
      const constraintOptions = getMaxCameraConstraints(cameraFacing, targetDeviceId);

      let stream: MediaStream | null = null;
      let lastError: Error | null = null;

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err: any) {
          lastError = err;
          console.warn('Constraint failed, trying fallback:', err.name);
        }
      }

      if (!stream) {
        throw lastError || new Error('Failed to access camera');
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        streamRef.current = stream;
        
        await new Promise<void>((resolve, reject) => {
          const video = videoRef.current;
          if (!video) {
            reject(new Error('Video element not found'));
            return;
          }
          
          video.onloadedmetadata = () => {
            video.play()
              .then(() => {
                console.log('Camera started:', video.videoWidth, 'x', video.videoHeight);
                resolve();
              })
              .catch(() => resolve()); // Continue anyway - some browsers need user interaction
          };
          
          video.onerror = () => reject(new Error('Video error'));
          setTimeout(() => resolve(), 3000);
        });
        
        setIsActive(true);
        // Apply fast continuous autofocus
        await applyFastAutofocus(stream);
        detectZoomCapabilities();
        // Check flash support
        checkFlashSupport(stream);
        
        // Log actual resolution
        const settings = stream.getVideoTracks()[0]?.getSettings?.();
        console.log(`Rapid scan camera: ${settings?.width}x${settings?.height}`);
        // Silent start - no toast on mobile for cleaner UX
      }
    } catch (error: any) {
      console.error("Camera error:", error);
      const messages: Record<string, string> = {
        NotAllowedError: "Camera permission denied. Please allow camera access.",
        NotFoundError: "No camera found on this device.",
        NotReadableError: "Camera is in use by another application.",
        OverconstrainedError: "Camera doesn't support requested settings.",
      };
      toast.error(messages[error.name] || `Camera error: ${error.message}`);
    }
  };

  // Check flash/torch support when camera starts
  const checkFlashSupport = async (stream: MediaStream) => {
    try {
      const track = stream.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities?.() as any;
      
      if (capabilities?.torch === true || capabilities?.torch !== undefined) {
        setFlashSupported(true);
        console.log('Flash/torch IS supported');
      } else {
        setFlashSupported(false);
        console.log('Flash/torch NOT supported by this camera');
      }
    } catch (e) {
      console.log('Flash check failed:', e);
      setFlashSupported(false);
    }
  };

  // Toggle flash/torch for dim lighting
  const toggleFlash = async () => {
    if (!streamRef.current) {
      toast.error('Camera not active');
      return;
    }
    
    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) {
        toast.error('No video track found');
        return;
      }

      const capabilities = track.getCapabilities?.() as any;
      console.log('Toggle flash - capabilities:', capabilities);
      
      if (!capabilities?.torch) {
        toast.info('Flash not available on this camera');
        setFlashSupported(false);
        return;
      }

      const newFlashState = !flashEnabled;
      console.log('Setting torch to:', newFlashState);
      
      await track.applyConstraints({
        advanced: [{ torch: newFlashState } as any]
      });
      
      setFlashEnabled(newFlashState);
      setFlashSupported(true);
      toast.success(newFlashState ? '🔦 Flash ON' : 'Flash OFF');
    } catch (e: any) {
      console.error('Flash toggle failed:', e);
      toast.error('Failed to toggle flash: ' + (e.message || 'Unknown error'));
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsActive(false);
    setFlashEnabled(false);
    setFlashSupported(false);
  };

  // Keyboard shutter trigger for USB mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isActive && (e.code === 'Space' || e.code === 'Enter' || e.key === 'VolumeUp' || e.key === 'VolumeDown')) {
        e.preventDefault();
        capturePhoto();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  // Handle mode change
  const handleModeChange = (mode: string) => {
    setCameraMode(mode as 'device' | 'usb');
    if (isActive) {
      stopCamera();
    }
    // Auto-select first device of the chosen mode
    const targetDevices = mode === 'usb' ? usbDevices : regularDevices;
    if (targetDevices.length > 0) {
      setSelectedDeviceId(targetDevices[0].deviceId);
    }
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

  const capturePhoto = async () => {
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

    // Trigger fast focus before capture
    if (streamRef.current) {
      await triggerFastFocus(streamRef.current);
      // Brief delay for focus to settle
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const canvas = document.createElement('canvas');
    
    // Use maximum resolution for capture - 8K target
    const captureWidth = Math.max(video.videoWidth, 3840);
    const captureHeight = Math.round(captureWidth * (7 / 5)); // 5:7 card ratio
    
    canvas.width = captureWidth;
    canvas.height = captureHeight;
    
    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
      willReadFrequently: true // Need this for anti-glare
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
      
      // Apply anti-glare processing only (OCR enhancement disabled to avoid color issues)
      applyAntiGlare(ctx, canvas, 0.25);
      
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
          
          // Play shutter sound - this is the only feedback needed
          if (shutterSoundRef.current) {
            shutterSoundRef.current.currentTime = 0;
            shutterSoundRef.current.play().catch(() => {});
          }

          // Haptic feedback on mobile
          if ('vibrate' in navigator) {
            navigator.vibrate(50);
          }
          // No toast notification - audio + haptic feedback is enough
        }
      }, 'image/jpeg', 0.95); // High quality for better card recognition
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

  const CONCURRENT_LIMIT = 10; // Process 10 cards at a time for speed

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
      // Play error sound
      if (errorSoundRef.current) {
        errorSoundRef.current.currentTime = 0;
        errorSoundRef.current.play().catch(() => {});
      }
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

  // Fetch and update pricing for a card
  const fetchPricingForCard = async (cardId: string, cardData: any) => {
    // Set loading state for this card
    setCaptures(prev => {
      const updated = prev.map(c => c.dbId === cardId ? { ...c, priceFetching: true } : c);
      capturesRef.current = updated;
      return updated;
    });

    try {
      const { data: pricing, error } = await supabase.functions.invoke('fetch-card-prices', {
        body: {
          cardName: cardData?.card_name,
          cardSet: cardData?.card_set,
          cardNumber: cardData?.card_number,
          gameType: cardData?.game_type,
          sportType: cardData?.sport_type,
        }
      });

      if (error) throw error;

      if (pricing) {
        // Update card in database
        await supabase.from('cards').update({
          current_price_raw: pricing.raw,
          current_price_psa9: pricing.psa9,
          current_price_psa10: pricing.psa10,
          suggested_price: pricing.suggested,
          ebay_listing_url: pricing.ebayUrl,
          last_price_update: new Date().toISOString(),
        }).eq('id', cardId);

        // Update UI with price and clear loading state
        setCaptures(prev => {
          const updated = prev.map(c => c.dbId === cardId ? { 
            ...c, 
            value: pricing.suggested || pricing.raw,
            priceFetching: false,
          } : c);
          capturesRef.current = updated;
          return updated;
        });
      } else {
        // Clear loading state if no pricing data
        setCaptures(prev => {
          const updated = prev.map(c => c.dbId === cardId ? { ...c, priceFetching: false } : c);
          capturesRef.current = updated;
          return updated;
        });
      }
    } catch (err) {
      console.error('Pricing fetch error for card:', cardId, err);
      // Clear loading state on error
      setCaptures(prev => {
        const updated = prev.map(c => c.dbId === cardId ? { ...c, priceFetching: false } : c);
        capturesRef.current = updated;
        return updated;
      });
    }
  };

  // Batch refresh all prices for completed cards
  const refreshAllPrices = async () => {
    const completedCards = captures.filter(c => c.status === 'completed' && c.dbId);
    if (completedCards.length === 0) {
      toast.info('No completed cards to refresh prices for');
      return;
    }

    setIsRefreshingPrices(true);
    toast.info(`Refreshing prices for ${completedCards.length} cards...`);

    let successCount = 0;
    let errorCount = 0;

    // Process in batches of 5 to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < completedCards.length; i += batchSize) {
      const batch = completedCards.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (card) => {
        try {
          await fetchPricingForCard(card.dbId!, {
            card_name: card.cardName,
            card_set: card.cardSet,
            card_number: card.cardNumber,
          });
          successCount++;
        } catch (err) {
          console.error('Batch price refresh error:', err);
          errorCount++;
        }
      }));
    }

    setIsRefreshingPrices(false);
    if (errorCount > 0) {
      toast.warning(`Refreshed ${successCount} prices, ${errorCount} failed`);
    } else {
      toast.success(`Successfully refreshed ${successCount} card prices`);
    }
  };

  const processCardAnalysis = async (captureId: string, imageUrl: string) => {
    try {
      // Use rapid identification endpoint (faster model, no pricing)
      const identifyResult = await supabase.functions.invoke('rapid-card-identify', { 
        body: { imageUrl } 
      });

      if (identifyResult.error) throw identifyResult.error;

      const cardData = identifyResult.data?.cardData;

      const { data: insertedCard, error: insertError } = await supabase.from('cards').insert({
        user_id: userId,
        card_name: cardData?.card_name || 'Unknown Card',
        card_set: cardData?.card_set,
        card_number: cardData?.card_number,
        rarity: cardData?.rarity,
        game_type: cardData?.game_type,
        sport_type: cardData?.sport_type,
        image_url: imageUrl,
        thumbnail_url: imageUrl,
        ocr_confidence: cardData?.confidence || 0,
        // Pricing will be fetched later in batch
      }).select('id').single();

      if (insertError) throw insertError;

      // Fetch pricing in background (don't block completion)
      fetchPricingForCard(insertedCard.id, cardData).catch(console.error);

      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { 
          ...c, 
          status: 'completed' as const, 
          cardName: cardData?.card_name,
          cardSet: cardData?.card_set,
          cardNumber: cardData?.card_number,
          rarity: cardData?.rarity,
          value: null, // Will update when pricing returns
          dbId: insertedCard?.id
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

  const handleCardUpdate = useCallback((captureId: string, updates: Partial<CapturedCard>) => {
    setCaptures(prev => {
      const updated = prev.map(c => c.id === captureId ? { ...c, ...updates } : c);
      capturesRef.current = updated;
      return updated;
    });
  }, []);

  const handleCardDelete = useCallback((captureId: string) => {
    setCaptures(prev => {
      const updated = prev.filter(c => c.id !== captureId);
      capturesRef.current = updated;
      return updated;
    });
    // Also remove from processing queue if queued
    processingQueueRef.current = processingQueueRef.current.filter(id => id !== captureId);
  }, []);

  const completedCount = captures.filter(c => c.status === 'completed').length;
  const errorCount = captures.filter(c => c.status === 'error').length;
  const processingCount = captures.filter(c => c.status === 'processing').length;
  const uploadingCount = captures.filter(c => c.status === 'uploading').length;
  const queuedCount = captures.filter(c => c.status === 'queued').length;
  const progress = captures.length > 0 ? (completedCount / captures.length) * 100 : 0;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-2 md:space-y-4">
      {/* Minimal Header - Hidden on mobile when camera active */}
      <div className={`${isActive ? 'hidden md:block' : ''}`}>
        <Card>
          <CardContent className="py-3 md:pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-lg md:text-2xl font-bold truncate">Rapid Scan</h3>
                <Badge variant={processing ? "default" : "secondary"} className="text-sm md:text-lg px-2 md:px-4 py-1">
                  {captures.length}/{MAX_CAPTURES}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {/* Camera Mode Toggle - Compact on mobile */}
                <Tabs value={cameraMode} onValueChange={handleModeChange}>
                  <TabsList className="h-8">
                    <TabsTrigger value="device" className="text-xs px-2">
                      <Smartphone className="h-3 w-3" />
                    </TabsTrigger>
                    <TabsTrigger value="usb" className="text-xs px-2" disabled={!hasUSBDevices}>
                      <Usb className="h-3 w-3" />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Camera Viewfinder - Full screen on mobile */}
      <Card className="overflow-hidden md:rounded-lg rounded-none md:mx-0 -mx-4">
        <CardContent className="p-0">
          {/* Device Selector - Hidden on mobile when scanning */}
          {(cameraMode === 'usb' ? usbDevices : devices).length > 1 && (
            <div className="hidden md:block p-4 border-b bg-background/80">
              <CameraDeviceSelector
                devices={cameraMode === 'usb' ? usbDevices : devices}
                selectedDeviceId={selectedDeviceId}
                onDeviceChange={handleDeviceChange}
                onRefresh={refreshDevices}
                isLoading={devicesLoading}
              />
            </div>
          )}
          
          <div className="relative bg-black">
            {/* Video container - Fullscreen feel on mobile */}
            <div className="relative mx-auto md:max-w-md w-full" style={{ aspectRatio: '5/7' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              
              {/* Minimal Corner Guides Only */}
              <div className="absolute inset-0 pointer-events-none">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 140" preserveAspectRatio="none">
                  {/* Top-left corner */}
                  <path d="M 8 8 L 8 18 M 8 8 L 18 8" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                  {/* Top-right corner */}
                  <path d="M 92 8 L 92 18 M 92 8 L 82 8" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                  {/* Bottom-left corner */}
                  <path d="M 8 132 L 8 122 M 8 132 L 18 132" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                  {/* Bottom-right corner */}
                  <path d="M 92 132 L 92 122 M 92 132 L 82 132" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                </svg>
              </div>

              {/* Mobile: Floating count badge - top right */}
              <div className="md:hidden absolute top-3 right-3">
                <Badge variant="secondary" className="bg-black/60 text-white border-0 text-sm px-2 py-1 backdrop-blur-sm">
                  {captures.length}/{MAX_CAPTURES}
                </Badge>
              </div>

              {/* Zoom Controls - Repositioned for mobile */}
              <div className="absolute top-3 left-3">
                <ZoomControls
                  zoomLevel={zoomLevel}
                  minZoom={zoomCapabilities.min}
                  maxZoom={zoomCapabilities.max}
                  supported={zoomCapabilities.supported}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onZoomChange={setZoom}
                  onReset={resetZoom}
                  variant="overlay"
                />
              </div>

              {/* Mobile-Optimized Controls - Bottom bar */}
              <div className="absolute bottom-0 left-0 right-0 pb-safe">
                <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-12 pb-4 px-4">
                  <div className="flex items-center justify-between max-w-md mx-auto">
                    {/* Left controls - smaller */}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleCamera}
                        className="text-white hover:bg-white/20 h-10 w-10"
                      >
                        <SwitchCamera className="h-5 w-5" />
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleFlash}
                        className={`h-10 w-10 ${
                          flashEnabled 
                            ? 'text-yellow-400 bg-yellow-400/30' 
                            : flashSupported 
                              ? 'text-white hover:bg-white/20' 
                              : 'text-white/30'
                        }`}
                      >
                        <Zap className={`h-5 w-5 ${flashEnabled ? 'fill-yellow-400' : ''}`} />
                      </Button>
                    </div>
                    
                    {/* Center - Shutter button - Compact */}
                    <Button
                      size="icon"
                      onClick={capturePhoto}
                      disabled={captures.length >= MAX_CAPTURES}
                      className="rounded-full h-14 w-14 md:h-16 md:w-16 bg-white hover:bg-white/90 text-black shadow-lg"
                    >
                      <Camera className="h-6 w-6 md:h-7 md:w-7" />
                    </Button>

                    {/* Right controls */}
                    <div className="flex items-center gap-1">
                      {captures.length > 0 ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            if (processingQueueRef.current.length > 0 || queuedCount > 0) {
                              setIsPaused(false);
                              processQueue();
                            }
                            stopCamera();
                            setTimeout(() => onComplete(), 300);
                          }}
                          className="bg-green-600 hover:bg-green-700 text-white h-10 px-3 text-sm font-medium"
                        >
                          Done
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            stopCamera();
                            onComplete();
                          }}
                          className="text-white hover:bg-white/20 h-10 w-10"
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Compact Progress Section - Mobile optimized */}
      {captures.length > 0 && (
        <Card className="md:mx-0 -mx-4 rounded-none md:rounded-lg">
          <CardContent className="py-3 md:pt-6 md:space-y-4 space-y-2">
            <div className="flex justify-between items-center gap-2">
              <div className="flex gap-3 md:gap-6 text-xs md:text-sm font-medium flex-wrap">
                <span className="text-success flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 md:h-4 md:w-4" />
                  {completedCount}
                </span>
                {(processingCount > 0 || uploadingCount > 0) && (
                  <span className="text-blue-500 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
                    {processingCount + uploadingCount}
                  </span>
                )}
                {queuedCount > 0 && (
                  <span className="text-muted-foreground">
                    +{queuedCount}
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-destructive flex items-center gap-1">
                    <X className="h-3 w-3 md:h-4 md:w-4" />
                    {errorCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm md:text-lg font-bold tabular-nums">{Math.round(progress)}%</span>
                {completedCount > 0 && queuedCount === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={refreshAllPrices}
                    disabled={isRefreshingPrices}
                    className="gap-1 h-8 px-2 md:px-3 text-xs md:text-sm"
                  >
                    {isRefreshingPrices ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <DollarSign className="h-3 w-3" />
                    )}
                    <span className="hidden md:inline">{isRefreshingPrices ? 'Refreshing...' : 'Prices'}</span>
                  </Button>
                )}
                {queuedCount > 0 && (
                  <Button
                    size="sm"
                    variant={isPaused ? "default" : "outline"}
                    onClick={togglePause}
                    className="h-8 px-2 md:px-3"
                  >
                    {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progress} className="h-2 md:h-3" />
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {captures.map((capture) => (
                  <div 
                    key={capture.id} 
                    className="relative rounded-lg overflow-hidden border-2 bg-card transition-all"
                  >
                    <div className="relative" style={{ aspectRatio: '5/7' }}>
                      <img 
                        src={capture.preview} 
                        alt="Captured card"
                        className="w-full h-full object-cover"
                      />
                      {capture.status !== 'completed' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                          {(capture.status === 'uploading' || capture.status === 'processing' || capture.status === 'queued') && (
                            <Loader2 className="h-8 w-8 text-white animate-spin" />
                          )}
                          {capture.status === 'error' && (
                            <X className="h-8 w-8 text-red-500" />
                          )}
                        </div>
                      )}
                      {capture.status === 'completed' && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle className="h-5 w-5 text-green-500 drop-shadow-lg" />
                        </div>
                      )}
                    </div>
                    {capture.status === 'completed' && (
                      <div className="p-2 space-y-1 bg-card">
                        <p className="text-xs font-medium line-clamp-2 leading-tight">
                          {capture.cardName || 'Unknown Card'}
                        </p>
                        {capture.cardSet && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {capture.cardSet}
                          </p>
                        )}
                        {capture.cardNumber && (
                          <p className="text-xs text-muted-foreground">
                            #{capture.cardNumber}
                          </p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          {capture.rarity && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {capture.rarity}
                            </Badge>
                          )}
                          {capture.priceFetching ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Loading...</span>
                            </span>
                          ) : capture.value != null && capture.value > 0 ? (
                            <span className="text-sm font-bold text-green-600">
                              ${capture.value.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">No price</span>
                          )}
                        </div>
                      </div>
                    )}
                    {capture.status === 'error' && (
                      <div className="p-2 bg-destructive/10">
                        <p className="text-xs text-destructive line-clamp-2">
                          {capture.error || 'Failed to process'}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Detailed Editable Card List */}
      <ScannedCardList cards={captures} onCardUpdate={handleCardUpdate} onCardDelete={handleCardDelete} />
    </div>
  );
};