import { useCallback, useMemo, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Usb, Trash2, Upload, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

import { useCardScanner } from "@/hooks/use-card-scanner";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useBatchScanner } from "@/hooks/use-batch-scanner";
import { useScannerSettings } from "@/hooks/use-scanner-settings";

import { UploadTab } from "./scanner/UploadTab";
import { BatchQueue } from "./scanner/BatchQueue";
import { BatchProgress } from "./scanner/BatchProgress";
import { CardIdentificationEditor } from "./scanner/CardIdentificationEditor";
import { NeedsFoilReviewQueue } from "./scanner/NeedsFoilReviewQueue";
import RapidScanCamera from "./scanner/RapidScanCamera";
import { USBPhoneCameraScanner } from "./scanner/USBPhoneCameraScanner";
import { ContinuityCameraIngest } from "./scanner/ContinuityCameraIngest";
import { RemoteScanDesktop } from "./scanner/RemoteScanDesktop";
import { USBBulkImport } from "./scanner/USBBulkImport";
import { DuplicateCardDialog } from "./scanner/DuplicateCardDialog";
import { RecentScansBox } from "./scanner/RecentScansBox";

interface ScannerProps {
  userId: string;
}

const Scanner = ({ userId }: ScannerProps) => {
  const { settings, updateSettings } = useScannerSettings();
  const location = useLocation();

  // Resolve initial tab: ?tab=usb URL param > settings.defaultScanTab
  const initialTab = useMemo<"rapid" | "phone" | "usb" | "upload">(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    if (tabParam === "rapid" || tabParam === "phone" || tabParam === "usb" || tabParam === "upload") return tabParam;
    if (location.hash === "#remote") return "phone";
    return (settings.defaultScanTab as any) || "rapid";
  }, [location.search, location.hash, settings.defaultScanTab]);

  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // If user navigates with a hash like #remote, scroll the remote card into view once tab is mounted
  useEffect(() => {
    if (location.hash === "#remote" && (activeTab === "phone" || activeTab === "usb")) {
      const t = setTimeout(() => {
        const el = document.getElementById("remote");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
      return () => clearTimeout(t);
    }
  }, [location.hash, activeTab]);

  const {
    file,
    preview,
    isScanning,
    scanProgress,
    ocrResult,
    pendingCard,
    duplicateCard,
    fileInputRef,
    folderInputRef,
    setFileWithPreview,
    handleScan,
    clearSelection,
    handleConfirmCard,
    handleCancelCard,
    handleSelectAlternative,
    handleConfirmDuplicate,
    handleSkipDuplicate,
  } = useCardScanner({ userId });

  const batch = useBatchScanner();

  const { handleFileSelect, handleDrop, handleDragOver } = useFileUpload({
    onSingleFile: setFileWithPreview,
    onMultipleFiles: batch.addFiles,
  });

  const handleUSBCapture = useCallback(
    (imageFile: File) => {
      setFileWithPreview(imageFile);
      setTimeout(() => handleScan(), 100);
    },
    [setFileWithPreview, handleScan]
  );

  const modeLabel =
    settings.scanMode === "SAVE" 
      ? "Save Mode — Scans are saved to your collection" 
      : settings.scanMode === "REMOVE"
      ? "Remove Mode — Scan cards to find and remove them"
      : "Scan & Price — Preview only, nothing saved";

  const cycleScanMode = () => {
    const modes: Array<"SAVE" | "SCAN_ONLY" | "REMOVE"> = ["SAVE", "SCAN_ONLY", "REMOVE"];
    const currentIndex = modes.indexOf(settings.scanMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    updateSettings({ scanMode: modes[nextIndex] });
  };

  return (
    <div className="space-y-6">
      {/* Recent Scans Box */}
      <RecentScansBox />

      {/* Mode Toggle */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">Scan Mode</div>
            {settings.scanMode === "REMOVE" && (
              <Trash2 className="h-4 w-4 text-destructive" />
            )}
          </div>
          <div className="text-xs text-muted-foreground">{modeLabel}</div>
        </div>

        <Button
          variant={settings.scanMode === "REMOVE" ? "destructive" : settings.scanMode === "SAVE" ? "default" : "secondary"}
          onClick={cycleScanMode}
        >
          {settings.scanMode === "SAVE" 
            ? "Switch to Scan & Price" 
            : settings.scanMode === "SCAN_ONLY" 
            ? "Switch to Remove Mode"
            : "Switch to Save Mode"}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4" role="tablist">
          <TabsTrigger value="rapid" className="flex items-center gap-2">
            <Camera className="h-4 w-4" aria-hidden="true" />
            Rapid Scan
          </TabsTrigger>
          <TabsTrigger value="phone" className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            Phone (QR)
          </TabsTrigger>
          <TabsTrigger value="usb" className="flex items-center gap-2">
            <Usb className="h-4 w-4" aria-hidden="true" />
            USB
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rapid">
          <RapidScanCamera />
        </TabsContent>

        <TabsContent value="phone">
          {pendingCard ? (
            <CardIdentificationEditor
              userId={userId}
              primaryCard={pendingCard.identifiedCard}
              alternatives={pendingCard.alternatives}
              imageUrl={preview || undefined}
              scanMode={pendingCard.scanMode}
              ownedCount={pendingCard.ownedCount}
              isInLibrary={pendingCard.isInLibrary}
              currentPriceRaw={pendingCard.fallbackData?.currentPriceRaw ?? null}
              onConfirm={handleConfirmCard}
              onSelectAlternative={handleSelectAlternative}
              onCancel={handleCancelCard}
            />
          ) : (
            <div id="remote" className="space-y-6">
              <RemoteScanDesktop userId={userId} onImageReceived={handleUSBCapture} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="usb">
          {pendingCard ? (
            <CardIdentificationEditor
              userId={userId}
              primaryCard={pendingCard.identifiedCard}
              alternatives={pendingCard.alternatives}
              imageUrl={preview || undefined}
              scanMode={pendingCard.scanMode}
              ownedCount={pendingCard.ownedCount}
              isInLibrary={pendingCard.isInLibrary}
              currentPriceRaw={pendingCard.fallbackData?.currentPriceRaw ?? null}
              onConfirm={handleConfirmCard}
              onSelectAlternative={handleSelectAlternative}
              onCancel={handleCancelCard}
            />
          ) : (
            <div className="space-y-6">
              <ContinuityCameraIngest onImageCaptured={handleUSBCapture} />
              <USBBulkImport />
              <USBPhoneCameraScanner onImageCaptured={handleUSBCapture} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="upload">
          {pendingCard ? (
            <CardIdentificationEditor
              userId={userId}
              primaryCard={pendingCard.identifiedCard}
              alternatives={pendingCard.alternatives}
              imageUrl={preview || undefined}
              scanMode={pendingCard.scanMode}
              ownedCount={pendingCard.ownedCount}
              isInLibrary={pendingCard.isInLibrary}
              currentPriceRaw={pendingCard.fallbackData?.currentPriceRaw ?? null}
              onConfirm={handleConfirmCard}
              onSelectAlternative={handleSelectAlternative}
              onCancel={handleCancelCard}
            />
          ) : (
            <UploadTab
              file={file}
              preview={preview}
              isScanning={isScanning}
              scanProgress={scanProgress}
              ocrResult={ocrResult}
              fileInputRef={fileInputRef}
              folderInputRef={folderInputRef}
              onFileSelect={handleFileSelect}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onScan={handleScan}
              onClear={clearSelection}
            />
          )}

          {batch.jobs.length > 0 && (
            <div className="mt-6">
              <BatchProgress
                cards={batch.jobs}
                total={batch.jobs.length}
                completed={batch.jobs.filter((c) => c.status === "completed").length}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {batch.jobs.length > 0 && <BatchQueue jobs={batch.jobs} onProcess={batch.start} />}

      {/* Foil Review Queue — batch review for foil-uncertain rapid scans */}
      <NeedsFoilReviewQueue userId={userId} />

      {/* Duplicate dialog remains ONLY for Save Mode behavior */}
      {duplicateCard && duplicateCard.existingCard && (
        <DuplicateCardDialog
          open={!!duplicateCard}
          existingCard={duplicateCard.existingCard}
          newCard={{
            card_name: duplicateCard.identifiedCard.card_name,
            card_set: duplicateCard.identifiedCard.card_set,
            confidence: duplicateCard.identifiedCard.confidence,
          }}
          newImageUrl={duplicateCard.imageUrl}
          onAddAnyway={handleConfirmDuplicate}
          onSkip={handleSkipDuplicate}
        />
      )}
    </div>
  );
};

export default Scanner;
