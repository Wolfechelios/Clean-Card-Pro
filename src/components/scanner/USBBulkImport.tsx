import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderOpen,
  Upload,
  Zap,
  ImageIcon,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Play,
  Pause,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { getDeviceTier } from "@/lib/performance/deviceTier";
import { idbAdd } from "@/lib/idbQueue";
import { useQueueProcessor } from "@/lib/queueProcessor";
import { compressImageForQueue } from "@/lib/imageCompressor";

interface ImportedPhoto {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "queued" | "error";
  error?: string;
}

export function USBBulkImport() {
  const [photos, setPhotos] = useState<ImportedPhoto[]>([]);
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [enqueueProgress, setEnqueueProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const tier = getDeviceTier();
  const { queueCount, processedCount, isRunning, start } = useQueueProcessor();

  const addFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast.error("No image files found");
      return;
    }

    const newPhotos: ImportedPhoto[] = imageFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      status: "pending",
    }));

    setPhotos((prev) => [...prev, ...newPhotos]);
    toast.success(`Added ${imageFiles.length} photo${imageFiles.length > 1 ? "s" : ""}`);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      addFiles(Array.from(e.target.files));
      e.target.value = "";
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      addFiles(files);
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.preview);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
  }, [photos]);

  const enqueueAll = useCallback(async () => {
    const pending = photos.filter((p) => p.status === "pending");
    if (pending.length === 0) {
      toast.info("No pending photos to process");
      return;
    }

    setIsEnqueuing(true);
    setEnqueueProgress(0);

    let queued = 0;
    let errors = 0;

    for (const photo of pending) {
      try {
        // Compress for queue storage
        const compressed = await imageCompressor(photo.file);
        const blob = compressed instanceof Blob ? compressed : photo.file;

        await idbAdd({
          id: photo.id,
          createdAt: Date.now(),
          status: "queued",
          blob,
          mime: blob.type || "image/jpeg",
          filename: photo.file.name,
        });

        setPhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, status: "queued" as const } : p))
        );
        queued++;
      } catch (err: any) {
        console.error("Enqueue error:", err);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photo.id ? { ...p, status: "error" as const, error: err.message } : p
          )
        );
        errors++;
      }

      setEnqueueProgress(Math.round(((queued + errors) / pending.length) * 100));
    }

    setIsEnqueuing(false);

    toast.success(
      `Queued ${queued} card${queued !== 1 ? "s" : ""}${errors > 0 ? `, ${errors} failed` : ""}`
    );

    // Auto-start the queue processor if not running
    if (!isRunning && queued > 0) {
      start();
    }
  }, [photos, isRunning, start]);

  const pendingCount = photos.filter((p) => p.status === "pending").length;
  const queuedCount = photos.filter((p) => p.status === "queued").length;
  const errorCount = photos.filter((p) => p.status === "error").length;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary" />
              Bulk Photo Import
            </CardTitle>
            <CardDescription>
              Drop your phone photos here — desktop power handles the rest
            </CardDescription>
          </div>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            <Zap className="mr-1 h-3 w-3" />
            {tier.tier.toUpperCase()} · {tier.maxWorkers} workers
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="border-2 border-dashed border-border rounded-lg p-8 text-center
                     hover:border-primary/50 hover:bg-accent/30 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Drag & drop card photos here</p>
          <p className="text-xs text-muted-foreground mt-1">
            Or click to browse — supports folders too
          </p>

          <div className="flex gap-2 justify-center mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <ImageIcon className="mr-2 h-4 w-4" />
              Select Files
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Select Folder
            </Button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="image/*"
          // @ts-ignore - webkitdirectory is non-standard
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Stats bar */}
        {photos.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{photos.length} photos</span>
            {pendingCount > 0 && (
              <Badge variant="outline">{pendingCount} pending</Badge>
            )}
            {queuedCount > 0 && (
              <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {queuedCount} queued
              </Badge>
            )}
            {errorCount > 0 && (
              <Badge variant="destructive">
                <XCircle className="mr-1 h-3 w-3" />
                {errorCount} errors
              </Badge>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <Trash2 className="mr-1 h-3 w-3" />
              Clear
            </Button>
          </div>
        )}

        {/* Enqueue progress */}
        {isEnqueuing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Adding to queue...</span>
              <span>{enqueueProgress}%</span>
            </div>
            <Progress value={enqueueProgress} />
          </div>
        )}

        {/* Thumbnail preview grid */}
        {photos.length > 0 && (
          <ScrollArea className="h-[200px] rounded-md border p-2">
            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative aspect-[2.5/3.5] rounded overflow-hidden bg-muted group"
                >
                  <img
                    src={photo.preview}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* Status overlay */}
                  {photo.status === "queued" && (
                    <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    </div>
                  )}
                  {photo.status === "error" && (
                    <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
                      <XCircle className="h-4 w-4 text-destructive" />
                    </div>
                  )}
                  {/* Remove button on hover */}
                  {photo.status === "pending" && (
                    <button
                      onClick={() => removePhoto(photo.id)}
                      className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XCircle className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Process button */}
        {pendingCount > 0 && (
          <Button
            size="lg"
            className="w-full"
            onClick={enqueueAll}
            disabled={isEnqueuing}
          >
            {isEnqueuing ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Enqueuing...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-5 w-5" />
                Process {pendingCount} Cards ({tier.maxWorkers} workers)
              </>
            )}
          </Button>
        )}

        {/* Active queue status */}
        {(queueSize > 0 || processedCount > 0) && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium flex items-center gap-2">
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Pause className="h-4 w-4 text-muted-foreground" />
                )}
                Queue: {queueSize} remaining · {processedCount} done
              </span>
              {!isRunning && queueSize > 0 && (
                <Button variant="outline" size="sm" onClick={start}>
                  <Play className="mr-1 h-3 w-3" />
                  Resume
                </Button>
              )}
            </div>
            {queueSize > 0 && (
              <Progress
                value={
                  processedCount + queueSize > 0
                    ? (processedCount / (processedCount + queueSize)) * 100
                    : 0
                }
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
