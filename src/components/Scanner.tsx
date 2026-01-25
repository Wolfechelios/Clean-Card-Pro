import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CameraTab from "./CameraTab";
import BinderScan from "./BinderScan";
import RapidScanCamera from "./scanner/RapidScanCamera";
import { useCameraCapture } from "@/hooks/use-camera-capture";
import { useCardScanner } from "@/hooks/use-card-scanner";

export default function Scanner() {
  const {
    videoRef,
    startCamera,
    stopCamera,
    isCameraActive,
  } = useCameraCapture();

  const { processScan } = useCardScanner();

  return (
    <Tabs defaultValue="camera" className="h-full w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="camera">Camera</TabsTrigger>
        <TabsTrigger value="rapid">Rapid Scan</TabsTrigger>
        <TabsTrigger value="binder">Binder Scan</TabsTrigger>
      </TabsList>

      {/* STANDARD CAMERA */}
      <TabsContent value="camera" className="h-full">
        <CameraTab
          videoRef={videoRef}
          startCamera={startCamera}
          stopCamera={stopCamera}
          isCameraActive={isCameraActive}
        />
      </TabsContent>

      {/* RAPID SCAN — NOW WIRED */}
      <TabsContent value="rapid" className="h-full">
        <RapidScanCamera
          videoRef={videoRef}
          startCamera={startCamera}
          stopCamera={stopCamera}
          isCameraActive={isCameraActive}
          onCapture={processScan}
          scanModeLabel="Save Mode"
        />
      </TabsContent>

      {/* BINDER SCAN */}
      <TabsContent value="binder" className="h-full">
        <BinderScan />
      </TabsContent>
    </Tabs>
  );
}
