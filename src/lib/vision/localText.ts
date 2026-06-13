import type { CardBrand, LocalOcrLine } from "./cardVisionTypes";
import { runPaddleOCR } from "../paddleOCR";

export function inferBrandFromLines(lines: LocalOcrLine[]): CardBrand {
  const text = lines.map((line) => line.text.toLowerCase()).join(" ");
  if (text.includes("trainer") || text.includes("energy") || /hp\s?\d{2,3}/.test(text)) return "pokemon";
  if (text.includes("1st edition") || text.includes("atk/") || text.includes("def/")) return "yugioh";
  if (text.includes("planeswalker") || text.includes("sorcery") || text.includes("instant")) return "mtg";
  if (text.includes("rookie") || text.includes("topps") || text.includes("panini") || text.includes("bowman")) return "sports";
  if (text.includes("don!!") || text.includes("op-")) return "one-piece";
  if (text.includes("inkwell") || text.includes("glimmer")) return "lorcana";
  return "unknown";
}

function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Unable to create OCR canvas context");
  context.putImageData(image, 0, 0);
  return canvas;
}

export async function readLocalText(image: ImageData): Promise<LocalOcrLine[]> {
  const result = await runPaddleOCR(imageDataToCanvas(image));
  return result.lines
    .filter((line) => line.text.trim().length > 0)
    .map((line) => ({
      text: line.text.trim(),
      confidence: Math.max(0, Math.min(1, Number(line.confidence) || 0)),
      region: {
        x: line.boundingBox.x / Math.max(1, image.width),
        y: line.boundingBox.y / Math.max(1, image.height),
        width: line.boundingBox.width / Math.max(1, image.width),
        height: line.boundingBox.height / Math.max(1, image.height),
      },
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
