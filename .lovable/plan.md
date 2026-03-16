

## Plan: Jetson Orin Integration for Hardware-Accelerated Card Scanning

### What You Have Today

Your app already has a **Local Accelerator** system:
- A Python FastAPI server (`mac-inference-server/`) with `/health`, `/identify`, `/ocr`, and `/ws/stream` endpoints
- Client-side connection layer that discovers and routes to this server via Settings
- The pipeline uses CPU-based OpenCV for card detection and Apple Vision/Tesseract for OCR

The Jetson Orin can replace the CPU pipeline stages with GPU-accelerated equivalents, making scanning significantly faster.

### What We Will Build

**1. Jetson-optimized inference server** (`jetson-inference-server/`)

A new FastAPI server tailored for the Orin, reusing the same API contract (`/health`, `/identify`, `/ocr`, `/ws/stream`) so the app connects seamlessly — no client changes needed.

Key upgrades over the Mac server:
- **TensorRT-accelerated YOLOv8** for card region detection (replaces OpenCV contour detection)
- **TensorRT PaddleOCR** for text extraction (replaces Apple Vision/Tesseract)
- **CUDA-accelerated image preprocessing** via OpenCV with CUDA backend
- **Optional: AI-based card identification** using a local vision LLM (e.g., llama-cpp with CLIP) instead of cloud calls

**2. Auto-discovery via mDNS**

The Jetson server will announce itself on the network using Avahi/mDNS (`_jetson-vision._tcp.local`), and the app will add a "Discover" button in Settings that finds it automatically — no manual IP entry needed.

**3. Enhanced capabilities reporting**

The `/health` endpoint will report Jetson-specific capabilities (TensorRT, CUDA cores, memory) so the app can adjust streaming parameters (higher FPS, higher resolution, more concurrent frames).

### Technical Details

#### Server Structure
```text
jetson-inference-server/
├── server/
│   ├── main.py              # FastAPI app (same API as mac-inference-server)
│   ├── pipeline/
│   │   ├── card_detect.py    # TensorRT YOLOv8 detector
│   │   ├── ocr_backends.py   # PaddleOCR with TensorRT
│   │   ├── image_io.py       # CUDA-accelerated image loading
│   │   ├── parse_fields.py   # Reuse from mac-inference-server
│   │   └── pricing.py        # Reuse from mac-inference-server
│   └── discovery.py          # mDNS/Avahi announcement
├── models/                   # TensorRT engine files
├── bootstrap.sh              # One-command Jetson setup
├── requirements.txt
└── README.md
```

#### Client Changes

1. **Settings UI** — Add mDNS discovery button alongside manual URL entry
2. **Scanner settings** — Add `gpuServerType: "mac" | "jetson"` to adapt stream parameters automatically (Jetson can handle higher FPS/resolution)
3. **Capability-aware streaming** — When connected to a Jetson, auto-increase `gpuStreamMaxFps` to 20+ and `gpuStreamTargetWidth` to 1080
4. **Health indicator** — Show "Jetson Orin" badge with GPU temp/utilization in the live preview overlay

#### Discovery Flow
```text
App Settings → "Discover Servers" button
        ↓
  Subnet sweep + mDNS query
        ↓
  Found: 192.168.1.42:8000 (Jetson Orin, TensorRT)
        ↓
  Auto-populate server URL + adjust stream prefs
```

#### bootstrap.sh (Jetson setup)
One-command install: installs CUDA/TensorRT deps, downloads/converts YOLO model to TensorRT engine, registers systemd service for auto-start.

### Files to Create/Edit

| File | Action |
|------|--------|
| `jetson-inference-server/server/main.py` | Create — FastAPI server with same API contract |
| `jetson-inference-server/server/pipeline/card_detect.py` | Create — TensorRT YOLOv8 card detector |
| `jetson-inference-server/server/pipeline/ocr_backends.py` | Create — PaddleOCR with TensorRT |
| `jetson-inference-server/server/pipeline/image_io.py` | Create — CUDA image loading |
| `jetson-inference-server/server/pipeline/parse_fields.py` | Create — Reuse/copy from mac server |
| `jetson-inference-server/server/pipeline/pricing.py` | Create — Reuse/copy from mac server |
| `jetson-inference-server/server/discovery.py` | Create — mDNS/Avahi service announcement |
| `jetson-inference-server/bootstrap.sh` | Create — One-command setup script |
| `jetson-inference-server/requirements.txt` | Create |
| `jetson-inference-server/README.md` | Create — Setup guide |
| `src/hooks/use-scanner-settings.ts` | Edit — Add `gpuServerType` field |
| `src/lib/gpuOffload/gpuAvailability.ts` | Edit — Parse capabilities to detect Jetson |
| `src/lib/gpuOffload/gpuSettings.ts` | Edit — Auto-tune stream prefs for Jetson |
| `src/pages/SettingsPage.tsx` | Edit — Add discover button, show server type badge |
| `src/components/scanner/RapidScanCamera.tsx` | Edit — Show Jetson badge in live overlay |

### Performance Expectations

| Stage | Mac (CPU) | Jetson Orin (TensorRT) |
|-------|-----------|----------------------|
| Card detection | ~50ms | ~5ms |
| OCR | ~200ms | ~30ms |
| Full pipeline | ~300ms | ~50ms |
| Live stream | 12 FPS | 20-30 FPS |

