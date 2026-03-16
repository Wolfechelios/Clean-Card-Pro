"""mDNS/Avahi service announcement for Jetson Orin discovery.

Announces _jetson-vision._tcp.local so the SER8 app can auto-discover.
"""
from __future__ import annotations

import socket
from typing import Optional

_info = None
_zeroconf = None


def _get_local_ip() -> str:
    """Best-effort local IP detection."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def start_mdns_announcement(port: int = 8000, name: str = "Jetson Vision Accelerator") -> None:
    """Register mDNS service. Requires zeroconf package."""
    global _info, _zeroconf

    try:
        from zeroconf import Zeroconf, ServiceInfo
    except ImportError:
        print("[mdns] zeroconf not installed — skipping mDNS announcement")
        return

    ip = _get_local_ip()
    ip_bytes = socket.inet_aton(ip)

    _info = ServiceInfo(
        "_jetson-vision._tcp.local.",
        f"{name}._jetson-vision._tcp.local.",
        addresses=[ip_bytes],
        port=port,
        properties={
            "platform": "jetson",
            "accelerator": "tensorrt",
            "version": "0.1.0",
            "ip": ip,
        },
    )

    _zeroconf = Zeroconf()
    _zeroconf.register_service(_info)
    print(f"[mdns] Announcing {name} on {ip}:{port}")


def stop_mdns_announcement() -> None:
    global _info, _zeroconf
    if _zeroconf and _info:
        _zeroconf.unregister_service(_info)
        _zeroconf.close()
        _info = None
        _zeroconf = None
