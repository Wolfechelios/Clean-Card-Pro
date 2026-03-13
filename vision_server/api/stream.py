"""WS /stream — Live streaming inference from camera frames."""

import time
import json
import logging
import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from utils.image_io import decode_bytes
from utils.model_manager import ModelManager

logger = logging.getLogger("vision-server.stream")
router = APIRouter()


@router.websocket("/stream")
async def stream(websocket: WebSocket):
    await websocket.accept()
    models: ModelManager = websocket.app.state.models
    logger.info("WebSocket /stream connected")

    frame_count = 0
    try:
        while True:
            # Accept binary image frames
            data = await websocket.receive_bytes()
            start = time.perf_counter()

            img = decode_bytes(data)
            detections = models.detect(img)

            elapsed = round((time.perf_counter() - start) * 1000, 1)
            frame_count += 1

            result = {
                "detections": detections,
                "latency_ms": elapsed,
                "frame": frame_count,
            }
            await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        logger.info(f"WebSocket /stream disconnected after {frame_count} frames")
    except Exception as e:
        logger.error(f"WebSocket /stream error: {e}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
