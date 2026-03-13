"""
mDNS / Avahi service announcement + /discover endpoint.
Allows the SER8 to auto-find the Jetson on the LAN.
"""

import socket
import subprocess
import logging

logger = logging.getLogger("vision-server.announce")

SERVICE_TYPE = "_jetson-vision._tcp"
SERVICE_NAME = "JetsonVisionCoprocessor"
AVAHI_SERVICE_FILE = "/etc/avahi/services/vision-server.service"

AVAHI_XML = """<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name>{name}</name>
  <service>
    <type>{stype}.local</type>
    <port>{port}</port>
    <txt-record>server=jetson-vision</txt-record>
    <txt-record>version=1.0.0</txt-record>
  </service>
</service-group>
"""


def get_local_ip() -> str:
    """Get the LAN IP of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_hostname() -> str:
    return socket.gethostname()


def register_avahi(port: int = 8000) -> bool:
    """Write Avahi service file so the Jetson is discoverable via mDNS."""
    try:
        xml = AVAHI_XML.format(name=SERVICE_NAME, stype=SERVICE_TYPE, port=port)
        with open(AVAHI_SERVICE_FILE, "w") as f:
            f.write(xml)
        subprocess.run(["systemctl", "restart", "avahi-daemon"], check=False, capture_output=True)
        logger.info(f"Avahi mDNS registered: {SERVICE_NAME} on port {port}")
        return True
    except PermissionError:
        logger.warning("Cannot write Avahi service file (not root) — mDNS skipped")
        return False
    except Exception as e:
        logger.warning(f"Avahi registration failed: {e}")
        return False


def get_discover_payload(port: int = 8000) -> dict:
    """Build the /discover response payload."""
    ip = get_local_ip()
    return {
        "service": "jetson-vision-coprocessor",
        "version": "1.0.0",
        "hostname": get_hostname(),
        "ip": ip,
        "port": port,
        "base_url": f"http://{ip}:{port}",
        "endpoints": [
            {"path": "/health", "method": "GET", "desc": "System health check"},
            {"path": "/infer", "method": "POST", "desc": "Object detection"},
            {"path": "/ocr", "method": "POST", "desc": "Text extraction"},
            {"path": "/rectify", "method": "POST", "desc": "Perspective correction"},
            {"path": "/embedding", "method": "POST", "desc": "Vector embedding"},
            {"path": "/stream", "method": "WS", "desc": "Live streaming"},
        ],
    }
