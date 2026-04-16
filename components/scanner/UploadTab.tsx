import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Upload, Camera, Loader2, CheckCircle, X, RefreshCw, FolderUp } from "lucide-react";
import type { OCRResult } from "@/hooks/use-card-scanner";

interface UploadTabProps {
  file: File | null;
  preview: string | null;
  isScanning: boolean;
  scanProgress: number;
  ocrResult: OCRResult | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  folderInputRef: React.RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onScan: () => void;
  onClear: () => void;
}

export function UploadTab({
  file,
  preview,
  isScanning,
  scanProgress,
  ocrResult,
  fileInputRef,
  folderInputRef,
  onFileSelect,
  onDrop,
  onDragOver,
  onScan,
  onClear,
}: UploadTabProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Upload Card Image(s)</CardTitle>
          <CardDescription>
            Drag and drop or click to select (up to 500MB total)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="relative flex min-h-[300px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/20 p-6 transition-colors hover:border-primary hover:bg-muted/30"
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Upload card image"
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onFileSelect}
              className="hidden"
              aria-label="Select files"
            />
            <input
              ref={folderInputRef}
              type="file"
              accept="image/*"
              {...({ webkitdirectory: "", directory: "" } as any)}
              multiple
              onChange={onFileSelect}
              className="hidden"
              aria-label="Select folder"
            />
      
            {preview ? (
              <div className="relative w-full">
                <img
                  src={preview}
                  alt="Card preview"
                  className="mx-auto max-h-[300px] rounded-lg object-contain"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute right-2 top-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear();
                  }}
                  aria-label="Remove selected image"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Drop your card images here</p>
                  <p className="text-sm text-muted-foreground">or use the buttons below to select files or folders</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Select Files
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                  >
                    <FolderUp className="mr-2 h-4 w-4" />
                    Select Folder
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Supports JPG, PNG, WEBP up to 500MB total
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={onScan}
              disabled={!file || isScanning}
              className="flex-1"
              size="lg"
            >
              {isScanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Camera className="mr-2 h-4 w-4" />
                  Scan Card
                </>
              )}
            </Button>
            
            {ocrResult && (
              <Button
                onClick={onScan}
                disabled={isScanning}
                variant="outline"
                size="lg"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Rescan
              </Button>
            )}
          </div>

          {isScanning && (
            <div className="space-y-2">
              <Progress value={scanProgress} aria-label="Scan progress" />
              <p className="text-center text-sm text-muted-foreground">
                {scanProgress}% complete
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Scan Results</CardTitle>
          <CardDescription>
            Card details extracted from the image
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ocrResult ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-success/10 p-4">
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle className="h-5 w-5" />
                  <p className="font-medium">Scan Complete</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-muted-foreground">Card Name</Label>
                  <p className="text-lg font-semibold">{ocrResult.cardName}</p>
                </div>

                {ocrResult.cardSet && (
                  <div>
                    <Label className="text-muted-foreground">Set</Label>
                    <p>{ocrResult.cardSet}</p>
                  </div>
                )}

                {ocrResult.cardNumber && (
                  <div>
                    <Label className="text-muted-foreground">Card Number</Label>
                    <p>{ocrResult.cardNumber}</p>
                  </div>
                )}

                <div>
                  <Label className="text-muted-foreground">OCR Confidence</Label>
                  <div className="flex items-center gap-2">
                    <Progress value={ocrResult.confidence} className="flex-1" />
                    <span className="text-sm font-medium">
                      {ocrResult.confidence.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <Label className="text-muted-foreground">Raw OCR Text</Label>
                <p className="mt-2 text-sm font-mono">{ocrResult.rawText}</p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center text-center text-muted-foreground">
              <div className="space-y-2">
                <Camera className="mx-auto h-12 w-12 opacity-20" />
                <p>No scan results yet</p>
                <p className="text-sm">Upload and scan a card to see results</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
