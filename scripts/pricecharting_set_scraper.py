#!/usr/bin/env python3
"""
Generate one offline Yu-Gi-Oh price JSON file from a PriceCharting set page.
Usage:
  python3 scripts/pricecharting_set_scraper.py "https://www.pricecharting.com/console/yugioh-..." public/price-data/yugioh/sets

This utility is intentionally outside the React app. Rapid Scan should never scrape live pages while scanning.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Install dependencies first: python3 -m pip install requests beautifulsoup4", file=sys.stderr)
    raise

# Priority: Match patterns like MRL-000, LOB-001, etc. at the end of the string.
CODE_RE = re.compile(r"([A-Z0-9]{2,8})-([0-9]{1,5})$", re.I)


def money(value: str | None):
    if not value:
        return None
    cleaned = re.sub(r"[^0-9.]", "", value)
    if not cleaned:
        return None
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def normalize_code(value: str | None):
    if not value:
        return None
    value = value.strip().upper().replace("–", "-").replace("—", "-")
    m = CODE_RE.search(value)
    if not m:
        return None # Only return a match if it fits the SET-NUMBER pattern
    return f"{m.group(1).upper()}-{m.group(2).upper()}"


def split_code(full_code: str | None):
    full = normalize_code(full_code)
    if not full:
        return None, None
    parts = full.split("-", 1)
    prefix = parts[0]
    number = parts[1] if len(parts) > 1 else None
    return prefix, number


def clean_name(name: str, code: str | None):
    name = re.sub(r"\s+", " ", name).strip()
    if code:
      name = re.sub(re.escape(code) + r"$", "", name, flags=re.I).strip()
    return name


def detect_set_code(soup: BeautifulSoup, rows: list[dict]):
    text = soup.get_text(" ")
    for label in ("Set Code", "Code"):
        m = re.search(label + r"\s*[:#]?\s*([A-Z0-9]{2,8})\b", text, re.I)
        if m:
            return m.group(1).upper()
    for row in rows:
        prefix, _ = split_code(row.get("fullCode"))
        if prefix:
            return prefix
    return "UNKNOWN"


def scrape(url: str):
    if "pricecharting.com" not in url:
        raise SystemExit("Please use a PriceCharting set URL.")

    res = requests.get(url, headers={"User-Agent": "Clean-Card-Pro price file generator/1.0"}, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    title = soup.find("h1")
    set_name = title.get_text(" ", strip=True) if title else "PriceCharting Yu-Gi-Oh Set"
    set_name = re.sub(r"\s*Price Guide\s*$", "", set_name, flags=re.I).strip()

    cards = []
    table = soup.find("table")
    if not table:
        raise SystemExit("No price table found on page.")

    headers = [th.get_text(" ", strip=True).lower() for th in table.find_all("th")]

    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2 or cells[0].name == "th":
            continue
        values = [c.get_text(" ", strip=True) for c in cells]
        link = cells[0].find("a") or tr.find("a")
        href = urljoin(url, link["href"]) if link and link.has_attr("href") else None
        
        # Handle Console view (where index 0 is image and index 1 is the title/ID)
        identity_cell = values[0] if values[0] else (values[1] if len(values) > 1 else "")
        code = normalize_code(identity_cell)
        prefix, number = split_code(code)
        card_name = clean_name(identity_cell, code)

        price_map = {"ungraded": None, "graded": None, "grade9": None, "psa10": None}
        for idx, header in enumerate(headers[:len(values)]):
            val = values[idx]
            if "ungraded" in header or "loose" in header or "raw" in header:
                price_map["ungraded"] = money(val)
            elif "grade 9" in header or "psa 9" in header:
                price_map["grade9"] = money(val)
            elif "psa 10" in header or "grade 10" in header:
                price_map["psa10"] = money(val)
            elif "graded" in header or "cib" in header:
                price_map["graded"] = money(val)

        # Fallback common PriceCharting order: product, ungraded, grade 9, psa 10.
        if price_map["ungraded"] is None and len(values) > 1:
            price_map["ungraded"] = money(values[1])
        if price_map["grade9"] is None and len(values) > 2:
            price_map["grade9"] = money(values[2])
        if price_map["psa10"] is None and len(values) > 3:
            price_map["psa10"] = money(values[3])

        if card_name:
            cards.append({
                "cardName": card_name,
                "fullCode": code,
                "setPrefix": prefix,
                "cardNumber": number,
                "edition": None,
                "rarity": None,
                "prices": price_map,
                "url": href,
            })

    set_code = detect_set_code(soup, cards)
    for card in cards:
        card["setPrefix"] = card.get("setPrefix") or set_code

    return {
        "source": "pricecharting",
        "game": "yugioh",
        "setCode": set_code,
        "setName": set_name,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceUrl": url,
        "cards": cards,
    }


def main(argv: list[str]):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    url = argv[1]
    out_dir = Path(argv[2]) if len(argv) >= 3 else Path("public/price-data/yugioh/sets")
    out_dir.mkdir(parents=True, exist_ok=True)
    data = scrape(url)
    out = out_dir / f"{data['setCode']}.json"
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out} with {len(data['cards'])} cards")


if __name__ == "__main__":
    main(sys.argv)
