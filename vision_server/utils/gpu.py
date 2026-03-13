"""GPU detection and info logging."""

import logging

logger = logging.getLogger("vision-server.gpu")

_gpu_available: bool | None = None


def is_gpu_active() -> bool:
    global _gpu_available
    if _gpu_available is not None:
        return _gpu_available
    _gpu_available = _check_gpu()
    return _gpu_available


def _check_gpu() -> bool:
    # Check CUDA via OpenCV
    try:
        import cv2
        if cv2.cuda.getCudaEnabledDeviceCount() > 0:
            return True
    except Exception:
        pass

    # Check via onnxruntime
    try:
        import onnxruntime as ort
        providers = ort.get_available_providers()
        if "CUDAExecutionProvider" in providers or "TensorrtExecutionProvider" in providers:
            return True
    except Exception:
        pass

    return False


def log_gpu_info():
    if is_gpu_active():
        logger.info("✅ GPU/CUDA acceleration available")
        try:
            import onnxruntime as ort
            logger.info(f"   ONNX providers: {ort.get_available_providers()}")
        except Exception:
            pass
    else:
        logger.warning("⚠ No GPU detected — running on CPU")
