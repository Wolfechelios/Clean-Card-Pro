"""GET /health — System status check."""

import time
import psutil
from fastapi import APIRouter, Request

from utils.gpu import is_gpu_active

router = APIRouter()


@router.get("/health")
async def health(request: Request):
    start = time.perf_counter()
    models: "ModelManager" = request.app.state.models

    return {
        "status": "ok",
        "gpu": "active" if is_gpu_active() else "inactive",
        "models_loaded": models.all_loaded(),
        "latency_ms": round((time.perf_counter() - start) * 1000, 1),
        "cpu_percent": psutil.cpu_percent(interval=0),
        "memory_percent": psutil.virtual_memory().percent,
    }
