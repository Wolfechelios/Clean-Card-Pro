import { useCallback } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Smartphone, Usb } from "lucide-react";
import { Button } from "@/components/ui/button";

import { useCardScanner } from "@/hooks/use-card-scanner";
import { useCameraCapture } from "@/hooks/use-camera-capture";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useBatchScanner } from "@/hooks/use-batch-scanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScannerSettings } from "@/hooks/use-scanner-settings";

import { UploadTab } from "./scanner/UploadTab";
import { CameraTab } from "./scanner/CameraTab";
import { BatchQueue } from "./scanner/BatchQueue";
import { BatchProgress } from "./scanner/BatchProgress";
import { CardIdentificationEditor } from "./scanner/CardIdentificationEditor";
import { RemoteScanDesktop } from "./scanner/RemoteScanDesktop";
import { RemoteScanMobile } from "./scanner/RemoteScanMobile";
import RapidScanCamera from "./scanner/RapidScanCamera";
import { USBPhoneCameraScanner } from "./scanner/USBPhoneCameraScanner";
import { DuplicateCardDialog } from "./scanner/DuplicateCardDialog";

interface ScannerProps {
  userId: string;
}

const Scanner = ({ userId }: ScannerProps) => {
  const isMobile = useIsMobile();
  const { settings, updateSettings } = useScannerSettings();

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

  const camera = useCameraCapture({
    onCapture: (capturedFile) => {
      setFileWithPreview(capturedFile);
    },
  });

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

  const handleRemoteCapture = useCallback(
    (imageFile: File) => {
      setFileWithPreview(imageFile);
      setTimeout(() => handleScan(), 100);
    },
    [setFileWithPreview, handleScan]
  );

  const modeLabel =
    settings.scanMode === "SAVE" ? "Save Mode (current behavior)" : "Scan & Price (non-destructive)";

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold">Scan Mode</div>
          <div className="text-xs text-muted-foreground">{modeLabel}</div>
        </div>

        <Button
          variant={settings.scanMode === "SAVE" ? "default" : "secondary"}
          onClick={() =>
            updateSettings({
              scanMode: settings.scanMode === "SAVE" ? "SCAN_ONLY" : "SAVE",
            })
          }
        >
          {settings.scanMode === "SAVE" ? "Switch to Scan & Price" : "Switch to Save Mode"}
        </Button>
      </div>

      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid w-full grid-cols-5" role="tablist">
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="camera">Camera</TabsTrigger>
          <TabsTrigger value="usb" className="flex items-center gap-2">
            <Usb className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">USB Phone</span>
          </TabsTrigger>
          <TabsTrigger value="rapid" className="flex items-center gap-2">
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Rapid Scan</span>
          </TabsTrigger>
          <TabsTrigger value="remote" className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Remote</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          {pendingCard ? (
            <CardIdentificationEditor
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

        <TabsContent value="camera">
          {pendingCard ? (
            <CardIdentificationEditor
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
            <CameraTab
              isCameraActive={camera.isCameraActive}
              videoRef={camera.videoRef}
              onStart={() => camera.startCamera()}
              onStop={camera.stopCamera}
              onToggle={camera.toggleCamera}
              onCapture={camera.capturePhoto}
              zoomLevel={camera.zoomLevel}
              zoomCapabilities={camera.zoomCapabilities}
              onZoomIn={camera.zoomIn}
              onZoomOut={camera.zoomOut}
              onZoomChange={camera.setZoom}
              onZoomReset={camera.resetZoom}
            />
          )}
        </TabsContent>

        <TabsContent value="usb">
          {pendingCard ? (
            <CardIdentificationEditor
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
            <USBPhoneCameraScanner onImageCaptured={handleUSBCapture} />
          )}
        </TabsContent>

        <TabsContent value="rapid">
          <RapidScanCamera />
        </TabsContent>

        <TabsContent value="remote">
          {pendingCard ? (
            <CardIdentificationEditor
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
          ) : isMobile ? (
            <RemoteScanMobile userId={userId} />
          ) : (
            <RemoteScanDesktop userId={userId} onImageReceived={handleRemoteCapture} />
          )}
        </TabsContent>
      </Tabs>

      {batch.jobs.length > 0 && <BatchQueue jobs={batch.jobs} onProcess={batch.start} />}

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
