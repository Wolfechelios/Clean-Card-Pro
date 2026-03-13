"""POST /ocr — Text extraction from an image."""

import time
import logging

from fastapi import APIRouter, File, UploadFile, Request
from pydantic import BaseModel

from utils.image_io import load_upload

logger = logging.getLogger("vision-server.ocr")
router = APIRouter()


class OcrResponse(BaseModel):
    text: str
    confidence: float
    latency_ms: float


@router.post("/ocr", response_model=OcrResponse)
async def ocr(request: Request, file: UploadFile = File(...)):
    start = time.perf_counter()
    img = await load_upload(file)
    models = request.app.state.models

    result = models.ocr(img)
    elapsed = round((time.perf_counter() - start) * 1000, 1)
    logger.info(f"/ocr — '{result['text'][:40]}' ({result['confidence']:.2f}) in {elapsed}ms")

    return OcrResponse(
        text=result["text"],
        confidence=result["confidence"],
        latency_ms=elapsed,
    )
