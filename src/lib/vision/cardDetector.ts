import type { CardRegion } from "./cardVisionTypes";

export interface DetectedCard {
  bounds: CardRegion;
  confidence: number;
  image: ImageData;
}

function cropImage(source: ImageData, region: CardRegion): ImageData {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const width = Math.max(1, Math.min(source.width - x0, Math.floor(region.width)));
  const height = Math.max(1, Math.min(source.height - y0, Math.floor(region.height)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const srcStart = ((y0 + y) * source.width + x0) * 4;
    const dstStart = y * width * 4;
    data.set(source.data.subarray(srcStart, srcStart + width * 4), dstStart);
  }
  return new ImageData(data, width, height);
}

export function detectPrimaryCard(image: ImageData): DetectedCard {
  const targetRatio = 2.5 / 3.5;
  const imageRatio = image.width / image.height;
  let width: number;
  let height: number;
  if (imageRatio > targetRatio) {
    height = image.height * 0.94;
    width = height * targetRatio;
  } else {
    width = image.width * 0.94;
    height = width / targetRatio;
  }
  const bounds = {
    x: (image.width - width) / 2,
    y: (image.height - height) / 2,
    width,
    height,
  };
  const fill = (width * height) / (image.width * image.height);
  return { bounds, confidence: Math.min(0.9, 0.55 + fill * 0.4), image: cropImage(image, bounds) };
}

export function cropNormalizedRegion(source: ImageData, region: CardRegion): ImageData {
  return cropImage(source, {
    x: region.x * source.width,
    y: region.y * source.height,
    width: region.width * source.width,
    height: region.height * source.height,
  });
}
