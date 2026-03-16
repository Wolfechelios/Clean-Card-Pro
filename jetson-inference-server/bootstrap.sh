#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Jetson Orin Vision Accelerator — One-Command Setup
# ============================================================
# Usage:  sudo bash bootstrap.sh
# Requires: JetPack 5.x or 6.x with CUDA + TensorRT
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/models"
VENV_DIR="${SCRIPT_DIR}/.venv"
SERVICE_NAME="vision-server"
PORT=8000

echo "===================================="
echo " Jetson Vision Accelerator Setup"
echo "===================================="

# ---- 1. Check we're on Jetson ----
if [ ! -f /etc/nv_tegra_release ] && [ ! -d /usr/local/cuda ]; then
    echo "⚠  Warning: This doesn't look like a Jetson device."
    echo "   Proceeding anyway — some features may not work."
fi

# ---- 2. System deps ----
echo ""
echo "[1/6] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    libopencv-dev \
    tesseract-ocr \
    avahi-daemon avahi-utils \
    wget curl

# Enable Avahi for mDNS
systemctl enable avahi-daemon 2>/dev/null || true
systemctl start avahi-daemon 2>/dev/null || true

# ---- 3. Python venv ----
echo ""
echo "[2/6] Creating Python virtual environment..."
if [ ! -d "${VENV_DIR}" ]; then
    python3 -m venv "${VENV_DIR}"
fi
source "${VENV_DIR}/bin/activate"

pip install --upgrade pip setuptools wheel -q

# ---- 4. Install Python deps ----
echo ""
echo "[3/6] Installing Python packages..."
pip install -r "${SCRIPT_DIR}/requirements.txt" -q

# ---- 5. Download & convert YOLOv8 model ----
echo ""
echo "[4/6] Setting up YOLOv8 card detection model..."
mkdir -p "${MODELS_DIR}"

YOLO_ONNX="${MODELS_DIR}/yolov8n.onnx"
YOLO_ENGINE="${MODELS_DIR}/yolov8n-card.engine"

if [ ! -f "${YOLO_ENGINE}" ]; then
    if [ ! -f "${YOLO_ONNX}" ]; then
        echo "   Downloading YOLOv8n ONNX model..."
        pip install ultralytics -q
        python3 -c "
from ultralytics import YOLO
model = YOLO('yolov8n.pt')
model.export(format='onnx', imgsz=640)
import shutil
shutil.move('yolov8n.onnx', '${YOLO_ONNX}')
"
    fi

    echo "   Converting to TensorRT engine (this may take several minutes)..."
    if command -v trtexec &>/dev/null; then
        trtexec \
            --onnx="${YOLO_ONNX}" \
            --saveEngine="${YOLO_ENGINE}" \
            --fp16 \
            --workspace=2048 \
            --verbose 2>&1 | tail -5
    else
        echo "   ⚠  trtexec not found — skipping TensorRT conversion."
        echo "   The server will fall back to OpenCV contour detection."
    fi
fi

# ---- 6. Systemd service ----
echo ""
echo "[5/6] Installing systemd service..."

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Jetson Vision Accelerator
After=network.target avahi-daemon.service
Wants=avahi-daemon.service

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
Environment=PATH=${VENV_DIR}/bin:/usr/local/cuda/bin:/usr/bin:/bin
Environment=YOLO_ENGINE_PATH=${YOLO_ENGINE}
Environment=LD_LIBRARY_PATH=/usr/local/cuda/lib64
ExecStart=${VENV_DIR}/bin/uvicorn server.main:app --host 0.0.0.0 --port ${PORT} --workers 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

# ---- Done ----
echo ""
echo "[6/6] Verifying..."
sleep 3

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo "===================================="
    echo " ✅ Setup complete!"
    echo ""
    echo " Server running at:"
    echo "   http://${LOCAL_IP}:${PORT}"
    echo ""
    echo " mDNS name:"
    echo "   _jetson-vision._tcp.local"
    echo ""
    echo " Health check:"
    echo "   curl http://${LOCAL_IP}:${PORT}/health"
    echo ""
    echo " In the app, go to Settings → Local Accelerator"
    echo " and click 'Discover Servers' or enter the URL above."
    echo "===================================="
else
    echo "⚠  Service failed to start. Check logs:"
    echo "   journalctl -u ${SERVICE_NAME} -f"
fi
