/**
 * Preprocess image for better card detection
 * Enhances contrast and sharpness for card edge detection
 */
export async function preprocessImage(imageData: ImageData): Promise<ImageData> {
  const { data, width, height } = imageData;
  const processed = new ImageData(width, height);

  // Apply adaptive contrast enhancement
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Convert to grayscale
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // Strong contrast enhancement for edge detection
    const enhanced = Math.min(255, Math.max(0, (gray - 128) * 2 + 128));

    processed.data[i] = enhanced;
    processed.data[i + 1] = enhanced;
    processed.data[i + 2] = enhanced;
    processed.data[i + 3] = data[i + 3];
  }

  return processed;
}

/**
 * Detect card boundaries in a binder page with padding
 * Returns regions where cards are likely located, with margins removed
 */
export interface CardRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function detectCardRegions(
  imageData: ImageData,
  columns: number = 3,
  rows: number = 3
): Promise<CardRegion[]> {
  const { width, height } = imageData;
  const regions: CardRegion[] = [];

  // Calculate base dimensions
  const baseCardWidth = width / columns;
  const baseCardHeight = height / rows;

  // Add padding to remove binder edges (10% margin on each side)
  const paddingX = baseCardWidth * 0.1;
  const paddingY = baseCardHeight * 0.1;

  const cardWidth = Math.floor(baseCardWidth - (paddingX * 2));
  const cardHeight = Math.floor(baseCardHeight - (paddingY * 2));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      regions.push({
        x: Math.floor(col * baseCardWidth + paddingX),
        y: Math.floor(row * baseCardHeight + paddingY),
        width: cardWidth,
        height: cardHeight,
      });
    }
  }

  return regions;
}

/**
 * Extract card image from a region
 */
export function extractCardImage(
  canvas: HTMLCanvasElement,
  region: CardRegion
): string {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = region.width;
  tempCanvas.height = region.height;

  const ctx = tempCanvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.drawImage(
    canvas,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height
  );

  return tempCanvas.toDataURL("image/jpeg", 0.9);
}
