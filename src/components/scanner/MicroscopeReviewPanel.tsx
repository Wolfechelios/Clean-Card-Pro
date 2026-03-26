import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Microscope, Maximize2 } from "lucide-react";
import { MicroscopeCapture } from "@/lib/microscope/types";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useState } from "react";

interface MicroscopeReviewPanelProps {
  capture: MicroscopeCapture;
  parentImageUrl: string | null;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  foil_detail: "Foil / Holo Detail",
  surface_detail: "Surface / Print",
  corner_detail: "Corner / Edge",
  text_detail: "Text / Number",
};

export function MicroscopeReviewPanel({ capture, parentImageUrl, onClose }: MicroscopeReviewPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Microscope className="h-4 w-4 text-primary" />
            Side-by-Side Review
          </CardTitle>
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-[10px]">
              {TYPE_LABELS[capture.captureType] || capture.captureType}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {capture.resolution.width}×{capture.resolution.height}
            </Badge>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded(!expanded)}>
              <Maximize2 className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResizablePanelGroup
          direction="horizontal"
          className={`rounded-lg border overflow-hidden ${expanded ? "h-[500px]" : "h-[280px]"}`}
        >
          {/* Full card image */}
          <ResizablePanel defaultSize={50} minSize={20}>
            <div className="h-full bg-muted/30 flex items-center justify-center p-2">
              {parentImageUrl ? (
                <img
                  src={parentImageUrl}
                  alt="Full card"
                  className="max-h-full max-w-full object-contain rounded"
                />
              ) : (
                <div className="text-center text-muted-foreground text-sm">
                  <p>No parent scan</p>
                  <p className="text-xs">Scan a card first, then capture microscope detail</p>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Microscope detail */}
          <ResizablePanel defaultSize={50} minSize={20}>
            <div className="h-full bg-black flex items-center justify-center p-2">
              <img
                src={capture.imageUrl}
                alt={`Microscope: ${capture.captureType}`}
                className="max-h-full max-w-full object-contain rounded"
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Device: {capture.deviceLabel}</span>
          <span>Sharpness: {Math.round(capture.sharpness)}%</span>
          <span>{new Date(capture.capturedAt).toLocaleTimeString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}
