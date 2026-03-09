from __future__ import annotations

import base64
import io
import re
from dataclasses import dataclass
from typing import Optional

import requests
from PIL import Image


DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<b64>.+)$")


@dataclass
class LoadedImage:
    image: Image.Image
    mime: str


def load_image_from_url(url: str, timeout: float = 6.5) -> LoadedImage:
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    mime = r.headers.get("content-type", "image/jpeg")
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    return LoadedImage(img, mime)


def load_image_from_data_url(data_url: str) -> LoadedImage:
    m = DATA_URL_RE.match(data_url.strip())
    if not m:
        raise ValueError("invalid data url")
    mime = m.group("mime")
    b64 = m.group("b64")
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return LoadedImage(img, mime)


def load_image_from_bytes(raw: bytes, mime: str = "image/jpeg") -> LoadedImage:
    """Load an image from raw file bytes (e.g. multipart upload)."""
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return LoadedImage(img, mime)


def load_image(
    image_url: Optional[str] = None,
    image_data_url: Optional[str] = None,
    image_bytes: Optional[bytes] = None,
) -> LoadedImage:
    if image_bytes:
        return load_image_from_bytes(image_bytes)
    if image_data_url:
        return load_image_from_data_url(image_data_url)
    if image_url:
        return load_image_from_url(image_url)
    raise ValueError("imageUrl, imageDataUrl, or image_bytes required")
