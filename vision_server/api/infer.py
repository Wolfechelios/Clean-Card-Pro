"""POST /infer — Object detection on an uploaded image."""

import time
import logging
from typing import List

import numpy as np
from fastapi import APIRouter, File, UploadFile, Request
from pydantic import BaseModel

from utils.image_io import load_upload

logger = logging.getLogger("vision-server.infer")
router = APIRouter()


class Detection(BaseModel):
    label: str
    confidence: float
    bbox: List[int]  # [x1, y1, x2, y2]


class InferResponse(BaseModel):
    detections: List[Detection]
    latency_ms: float


@router.post("/infer", response_model=InferResponse)
async def infer(request: Request, file: UploadFile = File(...)):
    start = time.perf_counter()
    img = await load_upload(file)
    models = request.app.state.models

    detections = models.detect(img)

    elapsed = round((time.perf_counter() - start) * 1000, 1)
    logger.info(f"/infer — {len(detections)} detections in {elapsed}ms")

    return InferResponse(
        detections=[
            Detection(label=d["label"], confidence=d["confidence"], bbox=d["bbox"])
            for d in detections
        ],
        latency_ms=elapsed,
    )
