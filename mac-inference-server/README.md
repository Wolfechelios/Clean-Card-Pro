# MintConditionMarket Local Accelerator (Mac/PC)

This folder is a **local inference server** you run on your **Mac M3 Pro** (recommended) or any PC. Your phone/PWA connects over LAN (or USB via ADB reverse) to offload OCR/identify/pricing.

## What you get

- **HTTP** endpoints for queue/batch processing
- **WebSocket streaming** endpoint for live camera overlay
- Best-effort OCR + card parsing + optional XLSX price lookup

> Note: This server is designed to be **plug-and-play** and **upgradeable**. You can drop in better models later (CoreML/ONNX) without changing the phone app.

---

## 1) Install

### Mac (recommended – Apple Vision OCR)

```bash
cd mac-inference-server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
pip install -r requirements-macos.txt
```

### Windows / Linux

```bash
cd mac-inference-server
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # mac/linux
python -m pip install -U pip
pip install -r requirements.txt
```

Optional OCR fallback (if you don't want Apple Vision):

- Install Tesseract
  - macOS: `brew install tesseract`
  - Windows: install tesseract from its official installer
- Then: `pip install pytesseract`

---

## 2) Put your XLSX price files here

Copy XLSX into:

```text
mac-inference-server/data/xlsx/
```

Or point to any folder:

```bash
export CARD_XLSX_DIR="/path/to/your/xlsx"
```

---

## 3) Run the server

```bash
cd mac-inference-server
source .venv/bin/activate
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Check:

- `http://<YOUR_LAN_IP>:8000/health`

---

## 4) Connect the app

In the app:

**Settings → Scanner Settings → Local Accelerator**

Set **Server Base URL** to:

- LAN: `192.168.1.5:8000`

### Android over USB (fast)

```bash
adb reverse tcp:8000 tcp:8000
```

Then set Server Base URL:

- `127.0.0.1:8000`

---

## Endpoints

### HTTP

- `GET /health`
- `POST /ocr`  `{ imageUrl | imageDataUrl }`
- `POST /identify` `{ imageUrl | imageDataUrl, wantPricing }`

### WebSocket

- `ws://<host>:8000/ws/stream`

Client sends:

- `hello`
- `ping`
- `frame` with `imageJpegDataUrl`

Server returns:

- `pong`
- `result` with parsed card fields + optional price

---

## Upgrading to real models (later)

Drop in:

- CoreML YOLO detector
- CoreML rarity classifier
- Condition estimator

Then swap `run_pipeline()` in `server/main.py` to call your models.
