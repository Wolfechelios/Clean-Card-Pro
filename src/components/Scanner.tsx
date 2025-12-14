import { useCallback } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Smartphone, Usb } from "lucide-react";

// Hooks
import { useCardScanner } from "@/hooks/use-card-scanner";
import { useCameraCapture } from "@/hooks/use-camera-capture";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useBatchScanner } from "@/hooks/use-batch-scanner";
import { useIsMobile } from "@/hooks/use-mobile";

// Components
import { UploadTab } from "./scanner/UploadTab";
import { CameraTab } from "./scanner/CameraTab";
import { BatchQueue } from "./scanner/BatchQueue";
import { BatchProgress } from "./scanner/BatchProgress";
import { CardIdentificationEditor } from "./scanner/CardIdentificationEditor";
import { RemoteScanDesktop } from "./scanner/RemoteScanDesktop";
import { RemoteScanMobile } from "./scanner/RemoteScanMobile";
import { RapidScanCamera } from "./scanner/RapidScanCamera";
import { USBPhoneCameraScanner } from "./scanner/USBPhoneCameraScanner";
import { DuplicateCardDialog } from "./scanner/DuplicateCardDialog";

interface ScannerProps {
  userId: string;
}

const Scanner = ({ userId }: ScannerProps) => {
  const isMobile = useIsMobile();

  // Card scanner hook for single card scanning
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

  // Batch scanner hook
  const batch = useBatchScanner({
    userId,
    onCardReady: (data) => {
      // This integrates batch scanning with card scanner state
      // For now, batch mode uses its own flow through RapidScanCamera
    },
  });

  // Camera capture hook
  const camera = useCameraCapture({
    onCapture: (capturedFile) => {
      setFileWithPreview(capturedFile);
    },
  });

  // File upload hook
  const { handleFileSelect, handleDrop, handleDragOver } = useFileUpload({
    onSingleFile: setFileWithPreview,
    onMultipleFiles: batch.addFilesToBatch,
  });

  // Handle image from USB scanner
  const handleUSBCapture = useCallback((imageFile: File) => {
    setFileWithPreview(imageFile);
    setTimeout(() => handleScan(), 100);
  }, [setFileWithPreview, handleScan]);

  // Handle image from remote scanner
  const handleRemoteCapture = useCallback((imageFile: File) => {
    setFileWithPreview(imageFile);
    setTimeout(() => handleScan(), 100);
  }, [setFileWithPreview, handleScan]);

  return (
    <div className="space-y-6">
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
          
          {/* Batch Progress */}
          {batch.batchCards.length > 0 && (
            <div className="mt-6">
              <BatchProgress
                cards={batch.batchCards}
                total={batch.batchCards.length}
                completed={batch.batchCards.filter(c => c.status === "completed").length}
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
              onConfirm={handleConfirmCard}
              onSelectAlternative={handleSelectAlternative}
              onCancel={handleCancelCard}
            />
          ) : (
            <USBPhoneCameraScanner onImageCaptured={handleUSBCapture} />
          )}
        </TabsContent>

        <TabsContent value="rapid">
          <RapidScanCamera 
            userId={userId}
            onComplete={() => toast.success('Rapid scan session complete!')}
          />
        </TabsContent>

        <TabsContent value="remote">
          {pendingCard ? (
            <CardIdentificationEditor
              primaryCard={pendingCard.identifiedCard}
              alternatives={pendingCard.alternatives}
              imageUrl={preview || undefined}
              onConfirm={handleConfirmCard}
              onSelectAlternative={handleSelectAlternative}
              onCancel={handleCancelCard}
            />
          ) : isMobile ? (
            <RemoteScanMobile userId={userId} />
          ) : (
            <RemoteScanDesktop 
              userId={userId} 
              onImageReceived={handleRemoteCapture}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Batch Queue - shown when files are queued */}
      {batch.scanJobs.length > 0 && (
        <BatchQueue
          jobs={batch.scanJobs}
          onProcess={batch.startBatchProcessing}
        />
      )}

      {/* Duplicate Card Dialog */}
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
