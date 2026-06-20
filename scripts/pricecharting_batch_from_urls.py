#!/usr/bin/env python3
"""
Generate offline Yu-Gi-Oh PriceCharting JSON files from a text file of set URLs.

Usage:
  python3 scripts/pricecharting_batch_from_urls.py pricecharting_urls.txt public/price-data/yugioh/sets
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from pricecharting_set_scraper import scrape
import json

URL_RE = re.compile(r"https?://(?:www\.)?pricecharting\.com/[^\s\"'<>]+", re.I)


def read_urls(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    urls: list[str] = []
    seen: set[str] = set()
    for match in URL_RE.findall(text):
        url = match.rstrip("],.;")
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        raise SystemExit(__doc__)
    url_file = Path(argv[1])
    out_dir = Path(argv[2]) if len(argv) >= 3 else Path("public/price-data/yugioh/sets")
    out_dir.mkdir(parents=True, exist_ok=True)

    urls = read_urls(url_file)
    if not urls:
        raise SystemExit("No PriceCharting URLs found in URL file.")

    failures: list[tuple[str, str]] = []
    for index, url in enumerate(urls, start=1):
        print(f"[{index}/{len(urls)}] Scraping {url}")
        try:
            data = scrape(url)
            out = out_dir / f"{data['setCode']}.json"
            out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  wrote {out} with {len(data.get('cards', []))} cards")
        except Exception as exc:
            failures.append((url, str(exc)))
            print(f"  failed: {exc}", file=sys.stderr)

    if failures:
        print("\nFailures:", file=sys.stderr)
        for url, error in failures:
            print(f"- {url}: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main(sys.argv)
