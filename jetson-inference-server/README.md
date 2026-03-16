# Jetson Orin Vision Accelerator

TensorRT-accelerated card scanning server for NVIDIA Jetson Orin. Provides the same API as the Mac Local Accelerator but with GPU-accelerated card detection and OCR.

## Quick Start

```bash
# On your Jetson Orin (JetPack 5.x or 6.x)
sudo bash bootstrap.sh
```

This will:
1. Install system dependencies (CUDA, OpenCV, Avahi)
2. Create a Python virtual environment
3. Download and convert YOLOv8 to a TensorRT engine
4. Install PaddleOCR with GPU acceleration
5. Register a systemd service that starts on boot
6. Announce via mDNS for auto-discovery

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status + GPU info |
| `/identify` | POST | Full pipeline: detect → OCR → parse → price |
| `/ocr` | POST | OCR only |
| `/ws/stream` | WS | Live frame streaming |

## Performance

| Stage | Mac (CPU) | Jetson Orin (TensorRT) |
|-------|-----------|----------------------|
| Card detection | ~50ms | ~5ms |
| OCR | ~200ms | ~30ms |
| Full pipeline | ~300ms | ~50ms |
| Live stream | 12 FPS | 20-30 FPS |

## Connecting from the App

The server announces itself via mDNS (`_jetson-vision._tcp.local`). In the app:

1. Go to **Settings → Local Accelerator**
2. Click **Discover Servers** — it will find your Jetson automatically
3. Or manually enter `http://<jetson-ip>:8000`

## Manual Start

```bash
source .venv/bin/activate
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

## Service Management

```bash
# Check status
sudo systemctl status vision-server

# View logs
journalctl -u vision-server -f

# Restart
sudo systemctl restart vision-server
```

## Requirements

- NVIDIA Jetson Orin (Nano/NX/AGX)
- JetPack 5.x or 6.x
- CUDA + TensorRT (included in JetPack)
