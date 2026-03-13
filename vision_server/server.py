"""
Jetson Vision Coprocessor — Main Server
FastAPI inference server exposing /health, /infer, /ocr, /rectify, /embedding, /stream
"""

import os
import sys
import time
import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── local imports ────────────────────────────────────────────
from api.health import router as health_router
from api.infer import router as infer_router
from api.ocr import router as ocr_router
from api.rectify import router as rectify_router
from api.embedding import router as embedding_router
from api.stream import router as stream_router
from api.discover import router as discover_router
from api.clients import router as clients_router
from utils.model_manager import ModelManager
from utils.gpu import log_gpu_info
from utils.announce import register_avahi, get_local_ip

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vision-server")

# ── global model manager ────────────────────────────────────
model_manager = ModelManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models on startup, release on shutdown."""
    logger.info("═" * 50)
    logger.info("Jetson Vision Coprocessor starting...")
    log_gpu_info()
    model_manager.load_all()
    app.state.models = model_manager
    port = int(os.environ.get("VISION_PORT", 8000))
    register_avahi(port)
    ip = get_local_ip()
    logger.info("All models loaded — server ready")
    logger.info(f"Discoverable at http://{ip}:{port}/discover")
    logger.info("═" * 50)
    yield
    logger.info("Shutting down — releasing models...")
    model_manager.unload_all()


app = FastAPI(
    title="Jetson Vision Coprocessor",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── mount routers ────────────────────────────────────────────
app.include_router(health_router)
app.include_router(infer_router)
app.include_router(ocr_router)
app.include_router(rectify_router)
app.include_router(embedding_router)
app.include_router(stream_router)
app.include_router(discover_router)


if __name__ == "__main__":
    port = int(os.environ.get("VISION_PORT", 8000))
    logger.info(f"Starting on 0.0.0.0:{port}")
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=port,
        workers=1,       # single worker to keep models in one process
        log_level="info",
    )
