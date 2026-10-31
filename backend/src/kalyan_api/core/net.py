"""Network utilities for peer IP extraction and canonical normalization."""

import ipaddress

from fastapi import Request

FALLBACK_IP = "0.0.0.0"  # noqa: S104


def normalize_ip(raw: str | None) -> str:
    """Normalize raw IP string to canonical presentation format, defaulting to 0.0.0.0.

    Guarantees:
    - Handles 'testclient', 'localhost', whitespace, IPv6, and unparseable strings.
    - An unparseable or empty host returns '0.0.0.0'.
    - Returns valid IP string suitable for PostgreSQL INET data type.
    """
    if not raw:
        return FALLBACK_IP

    raw_str = raw.strip()
    if raw_str in ("testclient", "localhost"):
        return "127.0.0.1"

    try:
        ip = ipaddress.ip_address(raw_str)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        return str(ip)
    except ValueError:
        return FALLBACK_IP


def client_ip(request: Request) -> str:
    """Extract peer IP address strictly from TCP socket peer.

    Security Guarantee:
    - Never inspects client request headers (e.g. forward headers, proxies)
      to prevent IP spoofing attacks on plaintext hospital LAN.
    """
    raw_host = request.client.host if request.client else None
    return normalize_ip(raw_host)
