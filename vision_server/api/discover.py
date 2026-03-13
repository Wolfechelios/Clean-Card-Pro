"""GET /discover — Auto-configuration endpoint for client apps."""

import os
from fastapi import APIRouter

from utils.announce import get_discover_payload

router = APIRouter()


@router.get("/discover")
async def discover():
    port = int(os.environ.get("VISION_PORT", 8000))
    return get_discover_payload(port)
