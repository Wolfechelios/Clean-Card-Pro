"""POST /embedding — Vector embedding for image similarity."""

import time
import logging
from typing import List

from fastapi import APIRouter, File, UploadFile, Request
from pydantic import BaseModel

from utils.image_io import load_upload

logger = logging.getLogger("vision-server.embedding")
router = APIRouter()


class EmbeddingResponse(BaseModel):
    vector: List[float]
    latency_ms: float


@router.post("/embedding", response_model=EmbeddingResponse)
async def embedding(request: Request, file: UploadFile = File(...)):
    start = time.perf_counter()
    img = await load_upload(file)
    models = request.app.state.models

    vec = models.embed(img)
    elapsed = round((time.perf_counter() - start) * 1000, 1)
    logger.info(f"/embedding — dim={len(vec)} in {elapsed}ms")

    return EmbeddingResponse(vector=vec, latency_ms=elapsed)
