"""PaddleOCR with TensorRT acceleration for Jetson Orin.

Falls back to Tesseract if PaddleOCR is not available.
"""
from __future__ import annotations

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


class PaddleOCRBackend(OCRBackend):
    name = "paddle_trt"

    def __init__(self):
        from paddleocr import PaddleOCR
        self._ocr = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            use_gpu=True,
            # TensorRT acceleration on Jetson
            enable_mkldnn=False,
            use_tensorrt=True,
            precision="fp16",
            show_log=False,
        )

    def extract_text(self, img: Image.Image) -> str:
        import numpy as np
        arr = np.array(img)
        result = self._ocr.ocr(arr, cls=True)
        if not result or not result[0]:
            return ""
        lines = []
        for line_info in result[0]:
            if line_info and len(line_info) >= 2:
                text_info = line_info[1]
                if isinstance(text_info, (list, tuple)) and len(text_info) >= 1:
                    lines.append(str(text_info[0]))
                elif isinstance(text_info, str):
                    lines.append(text_info)
        return "\n".join(lines).strip()


class TesseractOCRBackend(OCRBackend):
    name = "tesseract"

    def __init__(self):
        import pytesseract  # noqa
        self.pytesseract = pytesseract

    def extract_text(self, img: Image.Image) -> str:
        return (self.pytesseract.image_to_string(img, lang="eng") or "").strip()


def get_ocr_backend() -> Optional[OCRBackend]:
    # Priority 1: PaddleOCR with TensorRT
    try:
        return PaddleOCRBackend()
    except Exception:
        pass

    # Priority 2: Tesseract
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
