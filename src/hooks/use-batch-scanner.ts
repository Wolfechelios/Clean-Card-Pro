import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { analyzeCardFull } from "@/lib/analyzeCardFull";
import type { IdentifiedCard, Alternative, PendingCardData, OCRResult } from "./use-card-scanner";

export interface ScanJob {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'scanning' | 'complete' | 'error';
  result?: OCRResult;
  error?: string;
}

export interface BatchCard {
  id: string;
  fileName: string;
  status: "pending" | "processing" | "completed" | "error";
  error?: string;
  cardName?: string;
}

interface UseBatchScannerOptions {
  userId: string;
  onCardReady: (data: PendingCardData) => void;
}

export function useBatchScanner({ userId, onCardReady }: UseBatchScannerOptions) {
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([]);
  const [batchCards, setBatchCards] = useState<BatchCard[]>([]);
  const [batchQueue, setBatchQueue] = useState<ScanJob[]>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);

  const addFilesToBatch = useCallback((files: File[]) => {
    const jobs: ScanJob[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      preview: '',
      status: 'pending' as const
    }));

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
  }, []);

  const performOCR = async (imageUrl: string): Promise<OCRResult> => {
    const analysis = await analyzeCardFull(imageUrl);
    const ocrText = analysis.vision.ocr_text;
    const lines = ocrText.split("\n").filter((line) => line.trim());

    return {
      cardName: (lines[0] || "Unknown Card").trim(),
      cardSet: (lines.find((line) => line.toLowerCase().includes("set")) || "").replace(/set/i, "").trim(),
      cardNumber: (lines.find((line) => /\d+\/\d+/.test(line)) || "").trim(),
      confidence: 95,
      rawText: ocrText,
    };
  };

  const processNextCard = useCallback(async (queue: ScanJob[], index: number) => {
    // End of queue check
    if (index >= queue.length) {
      toast.success('Batch processing complete!');
      setBatchQueue([]);
      setCurrentBatchIndex(0);
      isProcessingRef.current = false;
      setIsProcessing(false);
      return;
    }

    const job = queue[index];
    
    // Mark current job as processing
    setBatchCards(prev => prev.map(c => 
      c.id === job.id ? { ...c, status: "processing" as const } : c
    ));
    
    setScanJobs(prev => prev.map(j => 
      j.id === job.id ? { ...j, status: 'scanning' as const } : j
    ));

    // Process this card in an isolated try-catch
    let success = false;
    let errorMessage = "";

    try {
      const fileExt = job.file.name.split(".").pop();
      const cardId = crypto.randomUUID();
      const fileName = `cards/${cardId}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("card-images")
        .upload(fileName, job.file);

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: signedUrlData, error: urlError } = await supabase.storage
        .from("card-images")
        .createSignedUrl(fileName, 60 * 60 * 24 * 365);

      if (urlError) throw new Error(`URL creation failed: ${urlError.message}`);
      const imageUrl = signedUrlData.signedUrl;

      const ocr = await performOCR(imageUrl);

      let enhancedData;
      let alternatives: Alternative[] = [];
      let fallbackData;
      
      // Try enhanced identification (isolated)
      try {
        const enhancedRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enhanced-card-identify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl, ocrText: ocr.rawText }),
          }
        );
        
        if (enhancedRes.ok) {
          const enhancedResult = await enhancedRes.json();
          if (enhancedResult.success && enhancedResult.cardData) {
            enhancedData = enhancedResult.cardData.primary || enhancedResult.cardData;
            alternatives = enhancedResult.cardData.alternatives || [];
          }
        }
      } catch (enhErr) {
        console.warn("Enhanced identification failed, using fallback:", enhErr);
      }

      // Fallback identification (isolated)
      if (!enhancedData) {
        try {
          const { data, error: aiError } = await supabase.functions.invoke(
            "identify-card",
            { body: { imageUrl, ocrText: ocr.rawText } }
          );
          if (!aiError && data) fallbackData = data;
        } catch (fallbackErr) {
          console.warn("Fallback identification failed:", fallbackErr);
        }
      }

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

      // Notify callback
      onCardReady({
        identifiedCard,
        alternatives,
        imageUrl,
        fallbackData: { ...fallbackData, jobId: job.id, batchIndex: index },
      });

      // Mark this card complete
      setBatchCards(prev => prev.map(c => 
        c.id === job.id ? { ...c, status: "completed" as const, cardName: identifiedCard.card_name } : c
      ));
      setScanJobs(prev => prev.map(j => 
        j.id === job.id ? { ...j, status: 'complete' as const } : j
      ));

      success = true;

    } catch (error: any) {
      console.error('Batch scan error for card:', job.file.name, error);
      errorMessage = error?.message || "Unknown error";
      
      // Mark this card as error
      setBatchCards(prev => prev.map(c => 
        c.id === job.id ? { ...c, status: "error" as const, error: errorMessage } : c
      ));
      
      setScanJobs(prev => prev.map(j => 
        j.id === job.id ? { ...j, status: 'error' as const, error: errorMessage } : j
      ));

      toast.error(`Failed: ${job.file.name} - ${errorMessage}`);
    }

    // ALWAYS advance to next card (whether success or failure)
    // Use setTimeout to break the call stack and prevent cascading failures
    const nextIndex = index + 1;
    setCurrentBatchIndex(nextIndex);
    
    // Small delay between cards to prevent rate limiting and give state time to settle
    setTimeout(() => {
      if (isProcessingRef.current && nextIndex < queue.length) {
        processNextCard(queue, nextIndex);
      } else if (nextIndex >= queue.length) {
        toast.success('Batch processing complete!');
        setBatchQueue([]);
        setCurrentBatchIndex(0);
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    }, 100);
  }, [onCardReady]);

  const startBatchProcessing = useCallback(() => {
    const pendingJobs = scanJobs.filter(j => j.status === 'pending');
    
    const initialCards = pendingJobs.map((job) => ({
      id: job.id,
      fileName: job.file.name,
      status: "pending" as const,
    }));
    
    setBatchCards(initialCards);
    setBatchQueue(pendingJobs);
    setCurrentBatchIndex(0);
    isProcessingRef.current = true;
    setIsProcessing(true);
    
    if (pendingJobs.length > 0) {
      processNextCard(pendingJobs, 0);
    }
  }, [scanJobs, processNextCard]);

  const continueToNextCard = useCallback(() => {
    const nextIndex = currentBatchIndex + 1;
    setCurrentBatchIndex(nextIndex);
    processNextCard(batchQueue, nextIndex);
  }, [currentBatchIndex, batchQueue, processNextCard]);

  const markCardComplete = useCallback((jobId: string, cardName: string) => {
    setBatchCards(prev => prev.map(c => 
      c.id === jobId ? { ...c, status: "completed" as const, cardName } : c
    ));
    setScanJobs(prev => prev.map(j => 
      j.id === jobId ? { ...j, status: 'complete' as const } : j
    ));
  }, []);

  const markCardError = useCallback((jobId: string, error: string) => {
    setBatchCards(prev => prev.map(c => 
      c.id === jobId ? { ...c, status: "error" as const, error } : c
    ));
    setScanJobs(prev => prev.map(j => 
      j.id === jobId ? { ...j, status: 'error' as const, error } : j
    ));
  }, []);

  const clearBatch = useCallback(() => {
    setScanJobs([]);
    setBatchCards([]);
    setBatchQueue([]);
    setCurrentBatchIndex(0);
    isProcessingRef.current = false;
    setIsProcessing(false);
  }, []);

  return {
    scanJobs,
    batchCards,
    currentBatchIndex,
    isProcessing,
    
    addFilesToBatch,
    startBatchProcessing,
    continueToNextCard,
    markCardComplete,
    markCardError,
    clearBatch,
  };
}
