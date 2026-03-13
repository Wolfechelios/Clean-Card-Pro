"""
Client registry — allows SER8 apps to register themselves with the Jetson,
and lets the Jetson track which clients are connected.

Reversible auto-setup: either side can initiate the handshake.
"""

import time
import asyncio
import logging
from typing import Dict, Optional
from pydantic import BaseModel

from fastapi import APIRouter, BackgroundTasks

router = APIRouter()
logger = logging.getLogger("vision-server.clients")

# ── In-memory client registry ──────────────────────────────

class ClientInfo(BaseModel):
    ip: str
    port: int = 5173
    name: str = "SER8"
    user_agent: str = ""
    registered_at: float = 0
    last_heartbeat: float = 0
    capabilities: list[str] = []

_clients: Dict[str, ClientInfo] = {}
_STALE_SECONDS = 120  # drop clients after 2 min without heartbeat


def get_active_clients() -> Dict[str, ClientInfo]:
    """Return only clients that have heartbeat within the stale window."""
    now = time.time()
    return {
        k: v for k, v in _clients.items()
        if (now - v.last_heartbeat) < _STALE_SECONDS
    }


# ── POST /register-client ─────────────────────────────────

class RegisterRequest(BaseModel):
    ip: str
    port: int = 5173
    name: str = "SER8"
    user_agent: str = ""
    capabilities: list[str] = []

@router.post("/register-client")
async def register_client(req: RegisterRequest):
    """SER8 registers itself so the Jetson knows where to push results."""
    now = time.time()
    key = f"{req.ip}:{req.port}"
    _clients[key] = ClientInfo(
        ip=req.ip,
        port=req.port,
        name=req.name,
        user_agent=req.user_agent,
        registered_at=now,
        last_heartbeat=now,
        capabilities=req.capabilities,
    )
    logger.info(f"Client registered: {key} ({req.name})")
    return {"status": "registered", "client_key": key}


# ── POST /heartbeat ────────────────────────────────────────

class HeartbeatRequest(BaseModel):
    ip: str
    port: int = 5173

@router.post("/heartbeat")
async def heartbeat(req: HeartbeatRequest):
    key = f"{req.ip}:{req.port}"
    if key in _clients:
        _clients[key].last_heartbeat = time.time()
        return {"status": "ok"}
    return {"status": "unknown_client", "message": "Call /register-client first"}


# ── GET /clients ───────────────────────────────────────────

@router.get("/clients")
async def list_clients():
    """List all active registered clients."""
    active = get_active_clients()
    return {
        "clients": [
            {
                "key": k,
                "ip": v.ip,
                "port": v.port,
                "name": v.name,
                "registered_at": v.registered_at,
                "last_heartbeat": v.last_heartbeat,
                "capabilities": v.capabilities,
                "stale": (time.time() - v.last_heartbeat) > 60,
            }
            for k, v in active.items()
        ],
        "count": len(active),
    }


# ── POST /scan-for-clients ────────────────────────────────
# Reverse discovery: Jetson scans the LAN for SER8 apps

import socket
import aiohttp

async def _probe_client(ip: str, port: int = 5173, timeout: float = 1.0) -> Optional[dict]:
    """Check if a SER8 app is running at the given address."""
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=timeout)
        ) as session:
            # SER8 web apps respond to any GET with HTML
            async with session.get(f"http://{ip}:{port}") as resp:
                if resp.status == 200:
                    return {"ip": ip, "port": port, "status": "found"}
    except Exception:
        pass
    return None


def _get_subnet_base() -> str:
    """Derive the /24 subnet from this machine's IP."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        parts = ip.split(".")
        return ".".join(parts[:3])
    except Exception:
        return "192.168.1"


@router.post("/scan-for-clients")
async def scan_for_clients():
    """
    Jetson-initiated reverse discovery.
    Scans the local subnet for SER8 web app instances.
    """
    subnet = _get_subnet_base()
    logger.info(f"Reverse scan: probing {subnet}.0/24 for SER8 clients...")

    tasks = []
    for i in range(1, 255):
        ip = f"{subnet}.{i}"
        tasks.append(_probe_client(ip, 5173, timeout=1.5))

    results = await asyncio.gather(*tasks)
    found = [r for r in results if r is not None]

    logger.info(f"Reverse scan complete: found {len(found)} potential clients")
    return {"scanned": 254, "found": found}


# ── POST /push-connect ─────────────────────────────────────
# Jetson pushes its config to a known SER8 client

class PushConnectRequest(BaseModel):
    client_ip: str
    client_port: int = 5173

@router.post("/push-connect")
async def push_connect(req: PushConnectRequest):
    """
    Push Jetson's discover payload to a SER8 client.
    The client must have a /api/jetson-connect endpoint or 
    be polling the Jetson for reverse setup.
    """
    from utils.announce import get_discover_payload
    import os
    
    port = int(os.environ.get("VISION_PORT", 8000))
    payload = get_discover_payload(port)
    payload["push_connect"] = True
    
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=3)
        ) as session:
            async with session.post(
                f"http://{req.client_ip}:{req.client_port}/api/jetson-connect",
                json=payload
            ) as resp:
                if resp.status == 200:
                    return {"status": "pushed", "target": f"{req.client_ip}:{req.client_port}"}
                return {"status": "rejected", "http_status": resp.status}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
