#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Jetson Vision Coprocessor — One-command bootstrap
# Run: sudo ./bootstrap.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
SERVICE_NAME="vision-server"
PORT=8000

echo "╔══════════════════════════════════════════════════╗"
echo "║  Jetson Vision Coprocessor — Bootstrap Installer ║"
echo "╚══════════════════════════════════════════════════╝"

# ── 1. System packages ──────────────────────────────────────
echo ""
echo "▶ [1/6] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
  python3 python3-pip python3-venv python3-dev \
  libopencv-dev python3-opencv \
  libglib2.0-0 libgl1-mesa-glx \
  tesseract-ocr libtesseract-dev \
  avahi-daemon avahi-utils libnss-mdns \
  curl wget git \
  2>/dev/null

# Enable Avahi for mDNS auto-discovery
systemctl enable avahi-daemon 2>/dev/null || true
systemctl start avahi-daemon 2>/dev/null || true

# Install CUDA toolkit if not present (JetPack usually has it)
if ! command -v nvcc &>/dev/null; then
  echo "  ⚠ nvcc not found — CUDA may not be installed."
  echo "  If on Jetson with JetPack, CUDA should be pre-installed."
  echo "  Continuing with CPU fallback support..."
fi

# ── 2. Python virtual environment ───────────────────────────
echo ""
echo "▶ [2/6] Setting up Python virtual environment..."
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
pip install --upgrade pip setuptools wheel -q

# ── 3. Python packages ──────────────────────────────────────
echo ""
echo "▶ [3/6] Installing Python packages..."
pip install -q \
  fastapi==0.115.* \
  uvicorn[standard]==0.34.* \
  python-multipart==0.0.* \
  websockets==14.* \
  pillow==11.* \
  numpy==1.* \
  opencv-python-headless==4.* \
  pyyaml==6.* \
  psutil==6.* \
  aiohttp==3.*

# ONNX Runtime — try GPU first, fall back to CPU
echo "  Installing ONNX Runtime..."
pip install -q onnxruntime-gpu 2>/dev/null || pip install -q onnxruntime

# PaddleOCR
echo "  Installing PaddleOCR..."
pip install -q paddlepaddle paddleocr 2>/dev/null || {
  echo "  PaddleOCR install failed — falling back to pytesseract"
  pip install -q pytesseract
}

# TensorRT Python bindings (Jetson JetPack includes system TRT)
echo "  Checking TensorRT..."
python3 -c "import tensorrt; print(f'  TensorRT {tensorrt.__version__} available')" 2>/dev/null || {
  echo "  TensorRT not available — will use ONNX Runtime"
}

# ── 4. Model directory ──────────────────────────────────────
echo ""
echo "▶ [4/6] Preparing models directory..."
MODEL_DIR="$SCRIPT_DIR/models"
mkdir -p "$MODEL_DIR"

# Download a lightweight YOLO model for card detection if not present
if [ ! -f "$MODEL_DIR/yolov8n.onnx" ]; then
  echo "  Downloading YOLOv8n ONNX model..."
  wget -q -O "$MODEL_DIR/yolov8n.onnx" \
    "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.onnx" 2>/dev/null || {
    echo "  ⚠ Could not download model. Place yolov8n.onnx in $MODEL_DIR manually."
  }
fi

# MobileNet embedding model placeholder
if [ ! -f "$MODEL_DIR/mobilenet_v3.onnx" ]; then
  echo "  Note: Place mobilenet_v3.onnx in $MODEL_DIR for embeddings."
  echo "  Using random embeddings as fallback until a model is provided."
fi

echo "  Models directory: $MODEL_DIR"
ls -la "$MODEL_DIR/" 2>/dev/null || true

# ── 5. Systemd service ──────────────────────────────────────
echo ""
echo "▶ [5/6] Registering systemd service..."

cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Jetson Vision Coprocessor Server
After=network.target

[Service]
Type=simple
User=$(logname 2>/dev/null || echo $SUDO_USER || echo root)
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/python $SCRIPT_DIR/server.py
Restart=always
RestartSec=5
Environment=VISION_PORT=$PORT
Environment=VISION_MODEL_DIR=$MODEL_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}.service
systemctl restart ${SERVICE_NAME}.service

# ── 6. Verify ───────────────────────────────────────────────
echo ""
echo "▶ [6/6] Verifying..."
sleep 3

if systemctl is-active --quiet ${SERVICE_NAME}; then
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  ✅ Vision server is RUNNING on port $PORT       ║"
  echo "║                                                  ║"
  echo "║  Health check:                                   ║"
  echo "║    curl http://$(hostname -I | awk '{print $1}'):$PORT/health  ║"
  echo "║                                                  ║"
  echo "║  Logs:                                           ║"
  echo "║    journalctl -u $SERVICE_NAME -f               ║"
  echo "╚══════════════════════════════════════════════════╝"
else
  echo "  ⚠ Service did not start. Check logs:"
  echo "    journalctl -u $SERVICE_NAME -n 50"
  echo ""
  echo "  Try running manually:"
  echo "    cd $SCRIPT_DIR && source .venv/bin/activate && python server.py"
fi
