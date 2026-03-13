"""POST /rectify — Perspective correction for card images."""

import time
import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, File, UploadFile, Request
from pydantic import BaseModel
from typing import List, Tuple

from utils.image_io import load_upload
from utils.rectify import find_card_corners, four_point_transform

logger = logging.getLogger("vision-server.rectify")
router = APIRouter()


class RectifyResponse(BaseModel):
    corners: List[List[int]]
    corrected_image: str  # base64-encoded JPEG
    latency_ms: float


@router.post("/rectify", response_model=RectifyResponse)
async def rectify(request: Request, file: UploadFile = File(...)):
    start = time.perf_counter()
    img = await load_upload(file)

    corners = find_card_corners(img)
    if corners is not None and len(corners) == 4:
        corrected = four_point_transform(img, corners)
    else:
        # No corners detected — return original
        corrected = img
        corners = [[0, 0], [img.shape[1], 0], [img.shape[1], img.shape[0]], [0, img.shape[0]]]

    # Encode corrected image to base64 JPEG
    _, buf = cv2.imencode(".jpg", corrected, [cv2.IMWRITE_JPEG_QUALITY, 92])
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    elapsed = round((time.perf_counter() - start) * 1000, 1)
    logger.info(f"/rectify — corners={corners is not None} in {elapsed}ms")

    return RectifyResponse(
        corners=[list(map(int, c)) for c in corners],
        corrected_image=b64,
        latency_ms=elapsed,
    )
