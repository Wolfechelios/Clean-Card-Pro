import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, SwitchCamera, X, CheckCircle, Loader2, Pause, Play, Focus, Zap, ZapOff, Usb, Smartphone, RefreshCw, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";
import { ScannedCardList } from "./ScannedCardList";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

      // Progressive constraint fallback chain - prioritize high quality
      const constraintOptions = [
        // Try 1: Maximum quality (4K)
        {
          video: {
            ...(targetDeviceId ? { deviceId: { exact: targetDeviceId } } : { facingMode: { ideal: cameraFacing } }),
            width: { ideal: 3840, min: 1920 },
            height: { ideal: 2160, min: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        },
        // Try 2: High quality (1080p+)
        {
          video: {
            ...(targetDeviceId ? { deviceId: targetDeviceId } : { facingMode: cameraFacing }),
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        },
        // Try 3: Basic constraints
        {
          video: targetDeviceId ? { deviceId: targetDeviceId } : { facingMode: cameraFacing },
          audio: false,
        },
        // Try 4: Minimal - just get any camera
        { video: true, audio: false },
      ];

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
        applyAutoFocus(stream);
        toast.success('Camera ready');
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

  // Apply auto-focus using ImageCapture API if available
  const applyAutoFocus = async (stream: MediaStream) => {
    try {
      const track = stream.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities?.() as any;
      const settings = track.getSettings?.() as any;
      
      console.log('Camera capabilities:', capabilities);
      console.log('Camera settings:', settings);
      
      // Check for torch/flash support - be thorough
      if (capabilities?.torch === true || capabilities?.torch !== undefined) {
        setFlashSupported(true);
        console.log('Flash/torch IS supported');
      } else {
        setFlashSupported(false);
        console.log('Flash/torch NOT supported by this camera');
      }
      
      if (capabilities?.focusMode?.includes('continuous')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' } as any]
        });
        console.log('Continuous auto-focus enabled');
      }
    } catch (e) {
      console.log('Auto-focus not available:', e);
    }
  };

  // Manual focus trigger for supported devices
  const triggerFocus = async () => {
    if (!streamRef.current) return;
    
    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      // Try to trigger single-shot auto-focus
      const capabilities = track.getCapabilities?.() as any;
      if (capabilities?.focusMode?.includes('single-shot')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'single-shot' } as any]
        });
        toast.success('Focus triggered');
        
        // Return to continuous after single-shot
        setTimeout(async () => {
          if (capabilities.focusMode.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as any]
            });
          }
        }, 500);
      } else {
        toast.info('Manual focus not supported on this device');
      }
    } catch (e) {
      console.log('Focus trigger failed:', e);
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
    
    // Use maximum resolution for capture - prioritize quality
    const captureWidth = Math.max(video.videoWidth, 3840);
    const captureHeight = Math.max(video.videoHeight, 5376); // 5:7 ratio at 4K width
    
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
          
          // Play shutter sound
          if (shutterSoundRef.current) {
            shutterSoundRef.current.currentTime = 0;
            shutterSoundRef.current.play().catch(() => {});
          }

          // Haptic feedback on mobile
          if ('vibrate' in navigator) {
            navigator.vibrate(50);
          }
          
          toast.success('Card captured!');
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-2xl font-bold">Rapid Scan</h3>
              <p className="text-sm text-muted-foreground">
                Capture cards quickly - processing happens automatically
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Camera Mode Toggle */}
              <Tabs value={cameraMode} onValueChange={handleModeChange}>
                <TabsList className="h-9">
                  <TabsTrigger value="device" className="text-xs px-3">
                    <Smartphone className="h-3 w-3 mr-1" />
                    Device
                  </TabsTrigger>
                  <TabsTrigger value="usb" className="text-xs px-3" disabled={!hasUSBDevices}>
                    <Usb className="h-3 w-3 mr-1" />
                    USB
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Badge variant={processing ? "default" : "secondary"} className="text-lg px-4 py-2">
                {captures.length}/{MAX_CAPTURES}
              </Badge>
            </div>
          </div>
          {cameraMode === 'usb' && (
            <p className="text-xs text-muted-foreground mt-2">
              Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Space</kbd> or <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to capture
            </p>
          )}
        </CardContent>
      </Card>

      {/* Camera Viewfinder */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Device Selector */}
          {(cameraMode === 'usb' ? usbDevices : devices).length > 1 && (
            <div className="p-4 border-b bg-background/80">
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
                    variant="ghost"
                    size="icon"
                    onClick={triggerFocus}
                    className="text-white hover:bg-white/20 h-12 w-12"
                    title="Tap to focus"
                  >
                    <Focus className="h-6 w-6" />
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleFlash}
                    className={`h-12 w-12 transition-all ${
                      flashEnabled 
                        ? 'text-yellow-400 bg-yellow-400/30 ring-2 ring-yellow-400' 
                        : flashSupported 
                          ? 'text-white hover:bg-white/20' 
                          : 'text-white/50'
                    }`}
                    title={flashEnabled ? 'Turn off flash' : flashSupported ? 'Turn on flash' : 'Flash not available'}
                  >
                    <Zap className={`h-6 w-6 ${flashEnabled ? 'fill-yellow-400' : ''}`} />
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
                {completedCount > 0 && queuedCount === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={refreshAllPrices}
                    disabled={isRefreshingPrices}
                    className="gap-2"
                  >
                    {isRefreshingPrices ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Refreshing...
                      </>
                    ) : (
                      <>
                        <DollarSign className="h-4 w-4" />
                        Refresh Prices
                      </>
                    )}
                  </Button>
                )}
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
      <ScannedCardList cards={captures} onCardUpdate={handleCardUpdate} />
    </div>
  );
};