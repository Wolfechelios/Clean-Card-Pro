# Embedded GLM-OCR integration

The scanner now calls `performEmbeddedCardOcr(...)` instead of sending the image to a cloud OCR function.

Runtime order:

1. Native embedded GLM-OCR bridge, when available.
2. Browser-local OCR fallback through the bundled OCR dependency.
3. Yu-Gi-Oh parser extracts set/card codes from raw OCR text.

## Native bridge contract

A desktop shell, Capacitor plugin, or native wrapper can expose any one of these objects:

```ts
window.cleanCardEmbeddedOcr
window.CleanCardEmbeddedOcr
window.Capacitor.Plugins.GlmOcr
```

The object should expose one of these functions:

```ts
scanImageDataUrl(imageDataUrl: string): Promise<Partial<EmbeddedOcrResult> | string>
scanCardImage(imageDataUrl: string): Promise<Partial<EmbeddedOcrResult> | string>
```

Preferred return shape:

```ts
type EmbeddedOcrResult = {
  engine: "native-glm-ocr";
  rawText: string;
  cardName: string | null;
  setCode: string | null;
  edition: string | null;
  confidence: number;
};
```

If the native runner returns only a string, the app still parses:

- Yu-Gi-Oh set code: `LOB-005`, `SDK-001`, `RA01-EN001`, etc.
- Card name fallback.
- Edition fallback.

## Placement for model/runtime files

For a packaged desktop/native app, place the OCR model/runtime beside the app bundle, not in the React source tree:

```text
resources/ocr/bin/<platform>/glmocr-runner
resources/ocr/models/glm-ocr.gguf
resources/ocr/models/mmproj-glm-ocr.gguf
```

The React app does not call Ollama, a cloud OCR endpoint, or a terminal process. It only calls the bridge when the wrapper provides it.
