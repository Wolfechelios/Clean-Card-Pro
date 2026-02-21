from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np
from PIL import Image


@dataclass
class CardRegion:
    x: int
    y: int
    w: int
    h: int


def pil_to_bgr(img: Image.Image) -> np.ndarray:
    arr = np.array(img)
    # RGB -> BGR
    return arr[:, :, ::-1].copy()


def detect_card_region(img: Image.Image) -> Optional[CardRegion]:
    """Best-effort card region detection using contours.

    Works well when the card is roughly centered and contrasts with background.
    Returns None when uncertain.
    """

    bgr = pil_to_bgr(img)
    h, w = bgr.shape[:2]

    # Downscale for speed
    scale = 900.0 / max(h, w)
    if scale < 1.0:
        bgr_small = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        bgr_small = bgr

    gray = cv2.cvtColor(bgr_small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 160)

    # Close small gaps
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

        # Card aspect ratio ~ 0.714 (w/h)
        ar = ww / float(hh)
        ar_score = 1.0 - min(1.0, abs(ar - 0.714) / 0.714)

        # Favor large and centered
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

    # Map back to original coordinates
    if scale < 1.0:
        inv = 1.0 / scale
        x = int(x * inv)
        y = int(y * inv)
        ww = int(ww * inv)
        hh = int(hh * inv)

    # Clamp
    x = max(0, min(x, w - 1))
    y = max(0, min(y, h - 1))
    ww = max(1, min(ww, w - x))
    hh = max(1, min(hh, h - y))

    return CardRegion(x=x, y=y, w=ww, h=hh)


def crop_region(img: Image.Image, region: Optional[CardRegion]) -> Image.Image:
    if not region:
        return img
    return img.crop((region.x, region.y, region.x + region.w, region.y + region.h))
