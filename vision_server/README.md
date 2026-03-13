# Jetson Orin Vision Coprocessor Service

A standalone inference server designed to run on a Jetson Orin (or any CUDA-capable Linux device) and act as a vision coprocessor for the SER8 primary computer.

## Quick Start

```bash
# SSH into your Jetson
ssh user@JETSON_IP

# Clone or copy this folder to the Jetson
scp -r vision_server/ user@JETSON_IP:~/vision_server

# Run the bootstrap (installs everything + creates systemd service)
cd ~/vision_server
chmod +x bootstrap.sh
sudo ./bootstrap.sh
```

That's it. The server will:
1. Install all system dependencies (OpenCV, CUDA libs, etc.)
2. Create a Python virtual environment
3. Install Python packages (FastAPI, PaddleOCR, ONNX, etc.)
4. Download default AI models
5. Register and start a systemd service (`vision-server.service`)

The server runs on **port 8000** and binds to all interfaces.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System status, GPU, model state |
| POST | `/infer` | Object detection on an image |
| POST | `/ocr` | Text extraction from an image |
| POST | `/rectify` | Perspective correction for cards |
| POST | `/embedding` | Vector embedding for similarity |
| WS | `/stream` | Live streaming inference |

## Architecture

```
SER8 (primary computer)          Jetson (vision coprocessor)
┌─────────────────────┐          ┌──────────────────────────┐
│  Card Scanner App   │──HTTP──▶│  FastAPI :8000            │
│                     │◀─JSON──│                            │
│  - UI               │          │  - Object Detection       │
│  - Database         │          │  - OCR                    │
│  - Pricing          │          │  - Perspective Correction  │
│  - Business Logic   │          │  - Embeddings             │
└─────────────────────┘          │  - CUDA / TensorRT        │
                                 └──────────────────────────┘
```

## Manual Start

```bash
cd ~/vision_server
source .venv/bin/activate
python server.py
```

## Configuration

Edit `config.yaml` or set environment variables:

```bash
VISION_PORT=8000
VISION_WORKERS=1
VISION_MODEL_DIR=./models
```

## Performance Targets

- Detection: < 80ms
- OCR: < 40ms
- Throughput: 15–30 FPS
