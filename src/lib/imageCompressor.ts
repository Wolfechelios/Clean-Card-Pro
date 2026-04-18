// src/lib/imageCompressor.ts
// Compress images before storing in IndexedDB queue to reduce memory pressure

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "jpeg" | "webp";
}

const DEFAULT_OPTIONS: CompressionOptions = {
  maxWidth: 1200,  // OCR-readable, not display-grade
  maxHeight: 1680, // ~5:7 ratio card
  quality: 0.75,
  format: "jpeg",
};

/**
 * Compress an image blob for queue storage.
 * Reduces memory footprint significantly while maintaining enough quality for identification.
 */
export async function compressImageForQueue(
  blob: Blob,
  options: CompressionOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      try {
        // Calculate target dimensions maintaining aspect ratio
        let { width, height } = img;
        const maxW = opts.maxWidth!;
        const maxH = opts.maxHeight!;

        if (width > maxW || height > maxH) {
          const ratioW = maxW / width;
          const ratioH = maxH / height;
          const ratio = Math.min(ratioW, ratioH);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Create canvas and draw resized image
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
          resolve(blob); // Fallback to original
          return;
        }

        // Use better quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob
        const mimeType = opts.format === "webp" ? "image/webp" : "image/jpeg";
        canvas.toBlob(
          (result) => {
            if (result) {
              // Only use compressed if it's actually smaller
              if (result.size < blob.size) {
                resolve(result);
              } else {
                resolve(blob);
              }
            } else {
              resolve(blob); // Fallback
            }
          },
          mimeType,
          opts.quality
        );
      } catch (e) {
        console.warn("[imageCompressor] Compression failed, using original:", e);
        resolve(blob);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.warn("[imageCompressor] Failed to load image, using original");
      resolve(blob); // Fallback to original
    };

    img.src = url;
  });
}

/**
 * Get estimated memory savings from compression
 */
export function estimateCompressionRatio(originalSize: number, compressedSize: number): number {
  if (originalSize <= 0) return 1;
  return compressedSize / originalSize;
}
