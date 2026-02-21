from __future__ import annotations

import io
import platform
from dataclasses import dataclass
from typing import Optional

from PIL import Image


@dataclass
class OCRResult:
    text: str
    backend: str


class OCRBackend:
    name = "base"

    def extract_text(self, img: Image.Image) -> str:
        raise NotImplementedError


class VisionOCRBackend(OCRBackend):
    name = "apple_vision"

    def __init__(self):
        # Lazy imports to avoid hard dependency on macOS extras.
        import objc  # noqa
        from Foundation import NSData  # noqa
        from Vision import VNRecognizeTextRequest, VNImageRequestHandler  # noqa

        self.NSData = NSData
        self.VNRecognizeTextRequest = VNRecognizeTextRequest
        self.VNImageRequestHandler = VNImageRequestHandler

        # Vision constants
        from Vision import VNRequestTextRecognitionLevelAccurate  # noqa

        self.VNRequestTextRecognitionLevelAccurate = VNRequestTextRecognitionLevelAccurate

    def extract_text(self, img: Image.Image) -> str:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        raw = buf.getvalue()

        data = self.NSData.dataWithBytes_length_(raw, len(raw))

        lines: list[str] = []

        def handler(request, error):
            if error is not None:
                return
            results = request.results() or []
            for obs in results:
                try:
                    s = obs.topCandidates_(1)[0].string()
                    if s:
                        lines.append(str(s))
                except Exception:
                    continue

        req = self.VNRecognizeTextRequest.alloc().initWithCompletionHandler_(handler)
        try:
            req.setRecognitionLevel_(self.VNRequestTextRecognitionLevelAccurate)
            req.setUsesLanguageCorrection_(True)
        except Exception:
            pass

        handler_obj = self.VNImageRequestHandler.alloc().initWithData_options_(data, None)
        err = None
        handler_obj.performRequests_error_([req], err)

        return "\n".join(lines).strip()


class TesseractOCRBackend(OCRBackend):
    name = "tesseract"

    def __init__(self):
        import pytesseract  # noqa

        self.pytesseract = pytesseract

    def extract_text(self, img: Image.Image) -> str:
        # Basic, trading-card friendly config
        return (self.pytesseract.image_to_string(img, lang="eng") or "").strip()


def get_ocr_backend() -> Optional[OCRBackend]:
    # Priority 1: Apple Vision on macOS (fast + accurate)
    if platform.system() == "Darwin":
        try:
            return VisionOCRBackend()
        except Exception:
            pass

    # Priority 2: pytesseract if installed
    try:
        return TesseractOCRBackend()
    except Exception:
        return None


def ocr_image(img: Image.Image) -> OCRResult:
    backend = get_ocr_backend()
    if not backend:
        return OCRResult(text="", backend="none")
    try:
        text = backend.extract_text(img)
        return OCRResult(text=text, backend=backend.name)
    except Exception:
        return OCRResult(text="", backend=backend.name)
