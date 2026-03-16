"""TensorRT-accelerated YOLOv8 card region detector.

Falls back to OpenCV contour detection when a TensorRT engine is not present.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
from PIL import Image

# --------------- TensorRT YOLOv8 detector ---------------

_ENGINE_PATH = os.environ.get(
    "YOLO_ENGINE_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "models", "yolov8n-card.engine"),
)

_trt_ctx = None


def _get_trt_context():
    """Lazy-load TensorRT engine."""
    global _trt_ctx
    if _trt_ctx is not None:
        return _trt_ctx
    if not os.path.isfile(_ENGINE_PATH):
        return None

    try:
        import tensorrt as trt
        import pycuda.driver as cuda
        import pycuda.autoinit  # noqa

        logger = trt.Logger(trt.Logger.WARNING)
        with open(_ENGINE_PATH, "rb") as f:
            runtime = trt.Runtime(logger)
            engine = runtime.deserialize_cuda_engine(f.read())

        context = engine.create_execution_context()

        # Allocate buffers
        inputs = []
        outputs = []
        bindings = []

        for i in range(engine.num_io_tensors):
            name = engine.get_tensor_name(i)
            shape = engine.get_tensor_shape(name)
            dtype = trt.nptype(engine.get_tensor_dtype(name))
            size = abs(int(np.prod(shape)))
            host_mem = cuda.pagelocked_empty(size, dtype)
            device_mem = cuda.mem_alloc(host_mem.nbytes)
            bindings.append(int(device_mem))

            mode = engine.get_tensor_mode(name)
            if mode == trt.TensorIOMode.INPUT:
                inputs.append({"host": host_mem, "device": device_mem, "shape": shape, "name": name})
            else:
                outputs.append({"host": host_mem, "device": device_mem, "shape": shape, "name": name})

        stream = cuda.Stream()

        _trt_ctx = {
            "engine": engine,
            "context": context,
            "inputs": inputs,
            "outputs": outputs,
            "bindings": bindings,
            "stream": stream,
        }
        return _trt_ctx
    except Exception as e:
        print(f"[card_detect] TensorRT load failed: {e}")
        return None


@dataclass
class CardRegion:
    x: int
    y: int
    w: int
    h: int


def _preprocess_yolo(img: Image.Image, input_size: int = 640) -> np.ndarray:
    """Resize + normalize for YOLO."""
    resized = img.resize((input_size, input_size), Image.BILINEAR)
    arr = np.array(resized, dtype=np.float32) / 255.0
    # HWC -> CHW
    arr = arr.transpose(2, 0, 1)
    return np.expand_dims(arr, axis=0).astype(np.float32)


def _detect_trt(img: Image.Image) -> Optional[CardRegion]:
    """Run YOLOv8 TensorRT detection."""
    ctx = _get_trt_context()
    if ctx is None:
        return None

    try:
        import pycuda.driver as cuda

        w_orig, h_orig = img.size
        input_data = _preprocess_yolo(img)

        inp = ctx["inputs"][0]
        np.copyto(inp["host"], input_data.ravel())
        cuda.memcpy_htod_async(inp["device"], inp["host"], ctx["stream"])

        ctx["context"].execute_async_v2(
            bindings=ctx["bindings"],
            stream_handle=ctx["stream"].handle,
        )

        for out in ctx["outputs"]:
            cuda.memcpy_dtoh_async(out["host"], out["device"], ctx["stream"])
        ctx["stream"].synchronize()

        # Parse YOLO output: find best detection
        raw = ctx["outputs"][0]["host"].reshape(ctx["outputs"][0]["shape"])

        # YOLOv8 output: [1, num_dets, 6] = [x1,y1,x2,y2,conf,cls]
        if raw.ndim == 3:
            dets = raw[0]
        else:
            dets = raw

        best_conf = 0.0
        best_box = None

        for det in dets:
            conf = float(det[4]) if len(det) > 4 else 0
            if conf > best_conf and conf > 0.3:
                best_conf = conf
                best_box = det[:4]

        if best_box is None:
            return None

        # Scale from 640 to original
        scale_x = w_orig / 640.0
        scale_y = h_orig / 640.0

        x1 = int(best_box[0] * scale_x)
        y1 = int(best_box[1] * scale_y)
        x2 = int(best_box[2] * scale_x)
        y2 = int(best_box[3] * scale_y)

        x1 = max(0, min(x1, w_orig - 1))
        y1 = max(0, min(y1, h_orig - 1))
        x2 = max(x1 + 1, min(x2, w_orig))
        y2 = max(y1 + 1, min(y2, h_orig))

        return CardRegion(x=x1, y=y1, w=x2 - x1, h=y2 - y1)
    except Exception as e:
        print(f"[card_detect] TensorRT inference failed: {e}")
        return None


# --------------- Fallback: OpenCV contour detection ---------------

def _pil_to_bgr(img: Image.Image) -> np.ndarray:
    arr = np.array(img)
    return arr[:, :, ::-1].copy()


def _detect_contour(img: Image.Image) -> Optional[CardRegion]:
    """CPU fallback: same algorithm as mac-inference-server."""
    bgr = _pil_to_bgr(img)
    h, w = bgr.shape[:2]

    scale = 900.0 / max(h, w)
    if scale < 1.0:
        bgr_small = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        bgr_small = bgr

    gray = cv2.cvtColor(bgr_small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 160)

    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)
    edges = cv2.erode(edges, kernel, iterations=1)

    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None

    best = None
    best_score = 0.0

    for c in cnts:
        area = cv2.contourArea(c)
        if area < 0.02 * (edges.shape[0] * edges.shape[1]):
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) != 4:
            continue
        x, y, ww, hh = cv2.boundingRect(approx)
        if ww <= 0 or hh <= 0:
            continue
        ar = ww / float(hh)
        ar_score = 1.0 - min(1.0, abs(ar - 0.714) / 0.714)
        area_score = min(1.0, area / float(edges.shape[0] * edges.shape[1]))
        cx = x + ww / 2.0
        cy = y + hh / 2.0
        center_score = 1.0 - min(1.0, ((cx - edges.shape[1] / 2.0) ** 2 + (cy - edges.shape[0] / 2.0) ** 2) ** 0.5 / (0.75 * max(edges.shape[0], edges.shape[1])))
        score = 0.55 * ar_score + 0.30 * area_score + 0.15 * center_score
        if score > best_score:
            best_score = score
            best = (x, y, ww, hh)

    if not best or best_score < 0.45:
        return None

    x, y, ww, hh = best
    if scale < 1.0:
        inv = 1.0 / scale
        x, y, ww, hh = int(x * inv), int(y * inv), int(ww * inv), int(hh * inv)

    x = max(0, min(x, w - 1))
    y = max(0, min(y, h - 1))
    ww = max(1, min(ww, w - x))
    hh = max(1, min(hh, h - y))

    return CardRegion(x=x, y=y, w=ww, h=hh)


# --------------- Public API ---------------

def detect_card_region(img: Image.Image) -> Optional[CardRegion]:
    """Detect card region using TensorRT (preferred) or OpenCV fallback."""
    region = _detect_trt(img)
    if region is not None:
        return region
    return _detect_contour(img)


def crop_region(img: Image.Image, region: Optional[CardRegion]) -> Image.Image:
    if not region:
        return img
    return img.crop((region.x, region.y, region.x + region.w, region.y + region.h))
