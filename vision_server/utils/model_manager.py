"""
Model Manager — Loads and manages all AI models in memory.
Provides detect(), ocr(), embed() methods.
"""

import os
import time
import logging
from typing import List, Dict, Any, Optional

import numpy as np
import cv2

from utils.gpu import is_gpu_active

logger = logging.getLogger("vision-server.models")

MODEL_DIR = os.environ.get("VISION_MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "models"))


class ModelManager:
    def __init__(self):
        self._detector = None       # ONNX/TRT detection model
        self._ocr_engine = None     # PaddleOCR or Tesseract
        self._embedder = None       # Embedding model
        self._loaded = False

    def all_loaded(self) -> bool:
        return self._loaded

    # ── Load ─────────────────────────────────────────────────

    def load_all(self):
        start = time.perf_counter()
        self._load_detector()
        self._load_ocr()
        self._load_embedder()
        self._loaded = True
        logger.info(f"All models loaded in {time.perf_counter()-start:.1f}s")

    def _load_detector(self):
        """Load YOLOv8 ONNX model for object detection."""
        model_path = os.path.join(MODEL_DIR, "yolov8n.onnx")
        if not os.path.exists(model_path):
            logger.warning(f"Detection model not found at {model_path} — using OpenCV DNN fallback")
            self._detector = None
            return

        try:
            import onnxruntime as ort
            providers = []
            if is_gpu_active():
                providers.append("CUDAExecutionProvider")
            providers.append("CPUExecutionProvider")

            self._detector = ort.InferenceSession(model_path, providers=providers)
            active = self._detector.get_providers()
            logger.info(f"Detector loaded: {model_path} (providers: {active})")
        except Exception as e:
            logger.error(f"Failed to load detector: {e}")
            self._detector = None

    def _load_ocr(self):
        """Load PaddleOCR or fall back to Tesseract."""
        try:
            from paddleocr import PaddleOCR
            self._ocr_engine = PaddleOCR(
                use_angle_cls=True,
                lang="en",
                show_log=False,
                use_gpu=is_gpu_active(),
            )
            logger.info("OCR engine: PaddleOCR (GPU)" if is_gpu_active() else "OCR engine: PaddleOCR (CPU)")
        except ImportError:
            logger.info("PaddleOCR not available — using Tesseract")
            try:
                import pytesseract
                self._ocr_engine = "tesseract"
                logger.info("OCR engine: Tesseract")
            except ImportError:
                logger.error("No OCR engine available!")
                self._ocr_engine = None

    def _load_embedder(self):
        """Load embedding model for similarity vectors."""
        model_path = os.path.join(MODEL_DIR, "mobilenet_v3.onnx")
        if not os.path.exists(model_path):
            logger.warning(f"Embedding model not found at {model_path} — using fallback")
            self._embedder = None
            return

        try:
            import onnxruntime as ort
            providers = []
            if is_gpu_active():
                providers.append("CUDAExecutionProvider")
            providers.append("CPUExecutionProvider")

            self._embedder = ort.InferenceSession(model_path, providers=providers)
            logger.info(f"Embedder loaded: {model_path}")
        except Exception as e:
            logger.error(f"Failed to load embedder: {e}")
            self._embedder = None

    # ── Unload ───────────────────────────────────────────────

    def unload_all(self):
        self._detector = None
        self._ocr_engine = None
        self._embedder = None
        self._loaded = False
        logger.info("All models unloaded")

    # ── Detect ───────────────────────────────────────────────

    def detect(self, img: np.ndarray) -> List[Dict[str, Any]]:
        """Run object detection. Returns list of {label, confidence, bbox}."""
        if self._detector is None:
            return self._detect_contour_fallback(img)

        try:
            # Preprocess for YOLOv8: resize to 640x640, normalize
            h, w = img.shape[:2]
            input_size = 640
            blob = cv2.dnn.blobFromImage(
                img, 1/255.0, (input_size, input_size),
                swapRB=True, crop=False,
            )

            input_name = self._detector.get_inputs()[0].name
            outputs = self._detector.run(None, {input_name: blob})

            # Parse YOLOv8 output
            return self._parse_yolo_output(outputs[0], w, h, input_size)
        except Exception as e:
            logger.error(f"Detection error: {e}")
            return self._detect_contour_fallback(img)

    def _parse_yolo_output(
        self, output: np.ndarray, orig_w: int, orig_h: int, input_size: int,
        conf_thresh: float = 0.25,
    ) -> List[Dict[str, Any]]:
        """Parse YOLOv8 ONNX output into detections."""
        detections = []

        # YOLOv8 output shape: (1, 84, 8400) — transpose to (8400, 84)
        if output.ndim == 3:
            output = output[0].T

        for row in output:
            scores = row[4:]
            class_id = int(np.argmax(scores))
            confidence = float(scores[class_id])

            if confidence < conf_thresh:
                continue

            cx, cy, bw, bh = row[:4]
            scale_x = orig_w / input_size
            scale_y = orig_h / input_size

            x1 = int((cx - bw / 2) * scale_x)
            y1 = int((cy - bh / 2) * scale_y)
            x2 = int((cx + bw / 2) * scale_x)
            y2 = int((cy + bh / 2) * scale_y)

            detections.append({
                "label": "card",  # For card scanning, all objects are cards
                "confidence": round(confidence, 3),
                "bbox": [max(0, x1), max(0, y1), min(orig_w, x2), min(orig_h, y2)],
            })

        # NMS
        if detections:
            boxes = np.array([d["bbox"] for d in detections], dtype=np.float32)
            scores = np.array([d["confidence"] for d in detections], dtype=np.float32)
            indices = cv2.dnn.NMSBoxes(
                boxes.tolist(), scores.tolist(), conf_thresh, 0.45,
            )
            if len(indices) > 0:
                indices = indices.flatten()
                detections = [detections[i] for i in indices]

        return detections

    def _detect_contour_fallback(self, img: np.ndarray) -> List[Dict[str, Any]]:
        """Simple contour-based card detection when no model is available."""
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blurred, 50, 150)
        contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        detections = []
        img_area = img.shape[0] * img.shape[1]

        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            area = cv2.contourArea(contour)
            if area < img_area * 0.05:
                continue

            x, y, w, h = cv2.boundingRect(contour)
            aspect = h / w if w > 0 else 0

            # Cards are roughly 2.5x3.5 ratio
            if 1.1 < aspect < 1.7:
                detections.append({
                    "label": "card",
                    "confidence": round(min(0.85, area / img_area * 2), 3),
                    "bbox": [x, y, x + w, y + h],
                })

        return detections

    # ── OCR ──────────────────────────────────────────────────

    def ocr(self, img: np.ndarray) -> Dict[str, Any]:
        """Extract text from image. Returns {text, confidence}."""
        if self._ocr_engine is None:
            return {"text": "", "confidence": 0.0}

        if self._ocr_engine == "tesseract":
            return self._ocr_tesseract(img)
        else:
            return self._ocr_paddle(img)

    def _ocr_paddle(self, img: np.ndarray) -> Dict[str, Any]:
        try:
            result = self._ocr_engine.ocr(img, cls=True)
            if not result or not result[0]:
                return {"text": "", "confidence": 0.0}

            lines = []
            total_conf = 0.0
            count = 0
            for line in result[0]:
                text = line[1][0]
                conf = line[1][1]
                lines.append(text)
                total_conf += conf
                count += 1

            return {
                "text": " ".join(lines),
                "confidence": round(total_conf / max(count, 1), 3),
            }
        except Exception as e:
            logger.error(f"PaddleOCR error: {e}")
            return {"text": "", "confidence": 0.0}

    def _ocr_tesseract(self, img: np.ndarray) -> Dict[str, Any]:
        try:
            import pytesseract
            text = pytesseract.image_to_string(img).strip()
            # Tesseract doesn't give per-char confidence easily, estimate
            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
            confs = [int(c) for c in data["conf"] if int(c) > 0]
            avg_conf = sum(confs) / max(len(confs), 1) / 100.0

            return {"text": text, "confidence": round(avg_conf, 3)}
        except Exception as e:
            logger.error(f"Tesseract error: {e}")
            return {"text": "", "confidence": 0.0}

    # ── Embeddings ───────────────────────────────────────────

    def embed(self, img: np.ndarray) -> List[float]:
        """Generate a vector embedding for the image."""
        if self._embedder is not None:
            return self._embed_onnx(img)
        return self._embed_fallback(img)

    def _embed_onnx(self, img: np.ndarray) -> List[float]:
        try:
            # Preprocess: resize to 224x224, normalize
            resized = cv2.resize(img, (224, 224))
            blob = resized.astype(np.float32) / 255.0
            blob = np.transpose(blob, (2, 0, 1))  # HWC -> CHW
            blob = np.expand_dims(blob, 0)         # Add batch dim

            # Normalize with ImageNet mean/std
            mean = np.array([0.485, 0.456, 0.406]).reshape(1, 3, 1, 1).astype(np.float32)
            std = np.array([0.229, 0.224, 0.225]).reshape(1, 3, 1, 1).astype(np.float32)
            blob = (blob - mean) / std

            input_name = self._embedder.get_inputs()[0].name
            outputs = self._embedder.run(None, {input_name: blob})
            vec = outputs[0].flatten().tolist()

            # L2 normalize
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = (np.array(vec) / norm).tolist()

            return vec
        except Exception as e:
            logger.error(f"Embedding ONNX error: {e}")
            return self._embed_fallback(img)

    def _embed_fallback(self, img: np.ndarray) -> List[float]:
        """Generate a simple color-histogram embedding as fallback."""
        resized = cv2.resize(img, (64, 64))
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)

        hist_h = cv2.calcHist([hsv], [0], None, [32], [0, 180]).flatten()
        hist_s = cv2.calcHist([hsv], [1], None, [32], [0, 256]).flatten()
        hist_v = cv2.calcHist([hsv], [2], None, [32], [0, 256]).flatten()

        vec = np.concatenate([hist_h, hist_s, hist_v])
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm

        return vec.tolist()
