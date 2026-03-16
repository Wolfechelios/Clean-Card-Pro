from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


RE_YGO_CODE = re.compile(r"\b([A-Z]{2,5})-?\s?(\d{1,4})\b")
RE_YGO_CODE_DASH = re.compile(r"\b([A-Z]{2,5})-(\d{1,4})\b")
RE_FRACTION_NUM = re.compile(r"\b(\d{1,4}\s*/\s*\d{1,4})\b")
RE_YEAR = re.compile(r"\b(19\d{2}|20\d{2})\b")


def _pick_name(lines: list[str]) -> str:
    # Prefer first line with letters and not too long.
    for ln in lines:
        s = ln.strip()
        if len(s) < 3:
            continue
        if sum(ch.isalpha() for ch in s) < 3:
            continue
        # Skip boilerplate
        if any(k in s.lower() for k in ["edition", "trading", "card", "copyright", "wizard", "konami"]):
            continue
        # Avoid all-caps noise
        return s
    return lines[0].strip() if lines else "Unknown Card"


@dataclass
class ParsedFields:
    card_name: str
    card_set: Optional[str]
    card_number: Optional[str]
    game_type: Optional[str]
    year: Optional[str]
    confidence: int


def parse_from_ocr(ocr_text: str) -> ParsedFields:
    text = (ocr_text or "").replace("\r", "\n")
    raw_lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    name = _pick_name(raw_lines) if raw_lines else "Unknown Card"

    card_set = None
    card_number = None
    game_type = None

    # Yu-Gi-Oh! set codes like LOB-001
    m = RE_YGO_CODE_DASH.search(text)
    if m:
        card_set = m.group(1)
        card_number = f"{m.group(1)}-{m.group(2)}"
        game_type = "Yu-Gi-Oh!"

    # Pokemon style numbering 123/198
    if not card_number:
        m2 = RE_FRACTION_NUM.search(text)
        if m2:
            card_number = m2.group(1).replace(" ", "")
            game_type = game_type or "Pokemon"

    # Year
    y = None
    my = RE_YEAR.search(text)
    if my:
        y = my.group(1)

    # Confidence heuristic
    conf = 55
    if name and name != "Unknown Card":
        conf += 15
    if card_number:
        conf += 15
    if card_set:
        conf += 5
    if game_type:
        conf += 5
    if len(ocr_text or "") < 10:
        conf -= 20

    conf = max(0, min(100, conf))

    return ParsedFields(
        card_name=name,
        card_set=card_set,
        card_number=card_number,
        game_type=game_type,
        year=y,
        confidence=conf,
    )
