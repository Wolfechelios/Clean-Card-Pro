"""CUDA-accelerated image loading for Jetson Orin.

Falls back to PIL if CUDA OpenCV is not available.
"""
from __future__ import annotations

import base64
import io
import re
from dataclasses import dataclass
from typing import Optional

import numpy as np
import requests
from PIL import Image

DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<b64>.+)$")

# Try CUDA-accelerated decode
_HAS_CUDA_CODEC = False
try:
    import cv2
    if hasattr(cv2, "cudacodec"):
        _HAS_CUDA_CODEC = True
except Exception:
    pass


@dataclass
class LoadedImage:
    image: Image.Image
    mime: str


def _decode_bytes_cuda(raw: bytes) -> Optional[np.ndarray]:
    """Attempt GPU-accelerated JPEG decode via OpenCV CUDA."""
    if not _HAS_CUDA_CODEC:
        return None
    try:
        import cv2
        buf = np.frombuffer(raw, dtype=np.uint8)
        gpu_mat = cv2.cuda.createGpuMatFromCudaMem(buf)
        reader = cv2.cudacodec.createImageReader(gpu_mat)
        ok, frame = reader.nextFrame()
        if ok:
            return frame.download()
    except Exception:
        pass
    return None


def _bytes_to_pil(raw: bytes) -> Image.Image:
    """Decode bytes to PIL, using CUDA if available for speed."""
    arr = _decode_bytes_cuda(raw)
    if arr is not None:
        # OpenCV gives BGR
        rgb = arr[:, :, ::-1]
        return Image.fromarray(rgb)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def load_image_from_url(url: str, timeout: float = 6.5) -> LoadedImage:
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    mime = r.headers.get("content-type", "image/jpeg")
    img = _bytes_to_pil(r.content)
    return LoadedImage(img, mime)


def load_image_from_data_url(data_url: str) -> LoadedImage:
    m = DATA_URL_RE.match(data_url.strip())
    if not m:
        raise ValueError("invalid data url")
    mime = m.group("mime")
    b64 = m.group("b64")
    raw = base64.b64decode(b64)
    img = _bytes_to_pil(raw)
    return LoadedImage(img, mime)


def load_image(image_url: Optional[str] = None, image_data_url: Optional[str] = None) -> LoadedImage:
    if image_data_url:
        return load_image_from_data_url(image_data_url)
    if image_url:
        return load_image_from_url(image_url)
    raise ValueError("imageUrl or imageDataUrl required")
