# Kalyan Hospital — System Architecture Specification

## 1. Physical & Network Topology

```mermaid
graph TD
  subgraph Local Hospital LAN
    Client1["Reception PC (Chrome)"]
    Client2["Doctor 1 OPD PC (Chrome)"]
    Client3["Doctor 2 Rehab PC (Chrome)"]
    Client4["Admin Workstation (Chrome)"]
    
    subgraph Centralized Local Server
      WebServer["FastAPI API Server (Uvicorn :8000)"]
      StaticSPA["React SPA (Vite / StaticFiles)"]
      PostgresDB[("PostgreSQL 16 DB (:5432)\nkalyan (Prod) / kalyan_dev (Dev)")]
      BackupStorage[("Local Encrypted Backup Storage\n(D:\\dr-sr\\backend\\var\\backups)")]
    end
    
    Client1 -->|HTTP/REST :8000| WebServer
    Client2 -->|HTTP/REST :8000| WebServer
    Client3 -->|HTTP/REST :8000| WebServer
    Client4 -->|HTTP/REST :8000| WebServer
    
    WebServer -->|psycopg3 TCP| PostgresDB
    WebServer -->|I/O| BackupStorage
    WebServer -->|Static Delivery| StaticSPA
  end
```

## 2. Invariants & Offline Guarantees
- Zero internet dependency for daily operations.
- Central local server holds the single source of truth.
- Local printing via browser print stylesheet targeting 80mm receipt printers and A4 prescription pads.
- Synchronized queue states across reception and doctor desks via HTTP polling / server-sent events.

