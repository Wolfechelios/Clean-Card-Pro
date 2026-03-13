"""Perspective correction utilities for card rectification."""

import cv2
import numpy as np
from typing import Optional, List


def find_card_corners(img: np.ndarray) -> Optional[np.ndarray]:
    """
    Detect the four corners of a card in the image using contour detection.
    Returns a 4x2 numpy array of corners in order: TL, TR, BR, BL.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 50, 150)

    # Dilate to close gaps
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edged = cv2.dilate(edged, kernel, iterations=2)

    contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Find largest contour by area
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    for contour in contours[:5]:
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

        if len(approx) == 4:
            # Check minimum area (at least 5% of image)
            area = cv2.contourArea(approx)
            img_area = img.shape[0] * img.shape[1]
            if area > img_area * 0.05:
                return _order_points(approx.reshape(4, 2))

    return None


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order points as: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype=np.float32)

    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # top-left has smallest sum
    rect[2] = pts[np.argmax(s)]   # bottom-right has largest sum

    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]   # top-right has smallest difference
    rect[3] = pts[np.argmax(d)]   # bottom-left has largest difference

    return rect


def four_point_transform(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Apply perspective transform to get a top-down view of a card."""
    rect = _order_points(pts.astype(np.float32))
    (tl, tr, br, bl) = rect

    # Compute output dimensions
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = max(int(width_a), int(width_b))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = max(int(height_a), int(height_b))

    # Standard card aspect ratio ~2.5 x 3.5 inches
    if max_width > 0 and max_height > 0:
        aspect = max_height / max_width
        # If close to card ratio, enforce it
        if 1.2 < aspect < 1.6:
            max_height = int(max_width * 1.4)

    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1],
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img, M, (max_width, max_height))

    return warped
