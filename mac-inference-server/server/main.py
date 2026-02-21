from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pipeline.image_io import load_image
from pipeline.card_detect import detect_card_region, crop_region
from pipeline.ocr_backends import ocr_image
from pipeline.parse_fields import parse_from_ocr
from pipeline.pricing import lookup_price

APP_VERSION = "0.1.0"

app = FastAPI(title="MintConditionMarket Local Accelerator", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IdentifyRequest(BaseModel):
    imageUrl: Optional[str] = None
    imageDataUrl: Optional[str] = None
    wantPricing: bool = True


class OcrRequest(BaseModel):
    imageUrl: Optional[str] = None
    imageDataUrl: Optional[str] = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def run_pipeline(image_url: Optional[str] = None, image_data_url: Optional[str] = None, want_pricing: bool = True) -> Dict[str, Any]:
    t0 = time.perf_counter()

    stages: Dict[str, float] = {}

    li = load_image(image_url=image_url, image_data_url=image_data_url)
    stages["load_ms"] = (time.perf_counter() - t0) * 1000

    t1 = time.perf_counter()
    region = detect_card_region(li.image)
    cropped = crop_region(li.image, region)
    stages["detect_ms"] = (time.perf_counter() - t1) * 1000

    t2 = time.perf_counter()
    ocr = ocr_image(cropped)
    stages["ocr_ms"] = (time.perf_counter() - t2) * 1000

    t3 = time.perf_counter()
    parsed = parse_from_ocr(ocr.text)
    stages["parse_ms"] = (time.perf_counter() - t3) * 1000

    pricing = None
    if want_pricing and parsed.card_name and parsed.card_name != "Unknown Card":
        t4 = time.perf_counter()
        hit = lookup_price(parsed.card_name)
        stages["price_ms"] = (time.perf_counter() - t4) * 1000
        if hit and hit.price_raw is not None:
            pricing = {
                "currentPriceRaw": float(hit.price_raw),
                "currentPricePsa9": None,
                "currentPricePsa10": None,
                "suggestedPrice": float(hit.price_raw),
                "ebayListingUrl": None,
                "source": hit.source,
                "matchScore": hit.score,
            }

    total_ms = (time.perf_counter() - t0) * 1000

    card_data = {
        "card_name": parsed.card_name,
        "card_set": parsed.card_set,
        "card_number": parsed.card_number,
        "rarity": None,
        "edition": None,
        "game_type": parsed.game_type,
        "sport_type": None,
        "year": parsed.year,
        "manufacturer": None,
        "confidence": int(parsed.confidence),
        "description": "",
    }

    return {
        "success": True,
        "source": "gpu",
        "cardData": card_data,
        "pricing": pricing,
        "ocrText": ocr.text,
        "metrics": {
            "server_ms": total_ms,
            "stage_ms": {k: round(v, 2) for k, v in stages.items()},
            "ocr_backend": ocr.backend,
        },
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "version": APP_VERSION,
        "capabilities": {
            "streaming": True,
            "http": True,
            "ocr": True,
            "identify": True,
            "pricing": True,
            "platform": "local",
            "version": APP_VERSION,
        },
    }


@app.post("/ocr")
def ocr_endpoint(req: OcrRequest):
    try:
        result = run_pipeline(image_url=req.imageUrl, image_data_url=req.imageDataUrl, want_pricing=False)
        return {
            "success": True,
            "text": result.get("ocrText") or "",
            "backend": result.get("metrics", {}).get("ocr_backend"),
        }
    except Exception as e:
        return {"success": False, "text": "", "error": str(e)}


@app.post("/identify")
def identify_endpoint(req: IdentifyRequest):
    try:
        return run_pipeline(image_url=req.imageUrl, image_data_url=req.imageDataUrl, want_pricing=req.wantPricing)
    except Exception as e:
        return {
            "success": False,
            "source": "gpu",
            "cardData": {
                "card_name": "Unknown Card",
                "card_set": None,
                "card_number": None,
                "rarity": None,
                "edition": None,
                "game_type": None,
                "sport_type": None,
                "year": None,
                "manufacturer": None,
                "confidence": 0,
                "description": "",
            },
            "error": str(e),
        }


@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket):
    await ws.accept()

    session_id = None
    prefs: Dict[str, Any] = {
        "maxFps": 12,
        "jpegQuality": 0.65,
        "targetWidth": 720,
    }

    try:
        while True:
            msg = await ws.receive_json()
            mtype = msg.get("type")

            if mtype == "hello":
                session_id = msg.get("sessionId")
                prefs.update(msg.get("prefs") or {})
                await ws.send_json(
                    {
                        "type": "hello",
                        "sessionId": session_id,
                        "capabilities": {
                            "streaming": True,
                            "http": True,
                            "ocr": True,
                            "identify": True,
                            "pricing": True,
                            "platform": "local",
                            "version": APP_VERSION,
                        },
                    }
                )
                continue

            if mtype == "ping":
                sent_at = int(msg.get("sentAt") or _now_ms())
                await ws.send_json(
                    {
                        "type": "pong",
                        "sessionId": msg.get("sessionId"),
                        "sentAt": sent_at,
                        "receivedAt": _now_ms(),
                    }
                )
                continue

            if mtype != "frame":
                continue

            frame_id = msg.get("frameId")
            data_url = msg.get("imageJpegDataUrl")
            recv_at = _now_ms()

            # Run inference off-thread to avoid blocking event loop
            t0 = time.perf_counter()
            try:
                result = await asyncio.to_thread(run_pipeline, None, data_url, True)
                server_ms = (time.perf_counter() - t0) * 1000

                card = result.get("cardData") or {}
                price = (result.get("pricing") or {}).get("currentPriceRaw")

                await ws.send_json(
                    {
                        "type": "result",
                        "sessionId": msg.get("sessionId"),
                        "frameId": frame_id,
                        "receivedAt": recv_at,
                        "serverMs": round(server_ms, 2),
                        "card": {
                            "name": card.get("card_name"),
                            "set": card.get("card_set"),
                            "number": card.get("card_number"),
                            "rarity": card.get("rarity"),
                            # client expects 0..1 for confidence in overlay
                            "confidence": (float(card.get("confidence") or 0) / 100.0),
                            "value": price,
                        },
                        "ocrText": result.get("ocrText") or "",
                    }
                )
            except Exception as e:
                await ws.send_json(
                    {
                        "type": "result",
                        "sessionId": msg.get("sessionId"),
                        "frameId": frame_id,
                        "receivedAt": recv_at,
                        "error": str(e),
                    }
                )

    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
