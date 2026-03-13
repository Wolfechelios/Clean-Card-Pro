"""Image I/O utilities for loading uploads and decoding bytes."""

import io
import numpy as np
import cv2
from fastapi import UploadFile


async def load_upload(file: UploadFile) -> np.ndarray:
    """Read an uploaded file into an OpenCV BGR image."""
    contents = await file.read()
    return decode_bytes(contents)


def decode_bytes(data: bytes) -> np.ndarray:
    """Decode raw image bytes into an OpenCV BGR image."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img
