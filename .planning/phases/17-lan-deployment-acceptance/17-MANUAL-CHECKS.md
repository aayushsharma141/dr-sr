# Phase 17 Manual Verification & Runbook Procedures

This runbook describes the operator procedures for installing, running, monitoring, and maintaining the Kalyan Hospital Centralized LAN Management Web Platform on the hospital's dedicated on-premise server PC.

---

## 1. Initial Hospital Server Installation (DEP-01)

### Prerequisites:
1. Windows 10/11 or Windows Server (x64) installed on the primary server PC.
2. PostgreSQL 18.6+ installed and running as a Windows service on `localhost:5432`.
3. Python 3.12+ (x64) installed with `python` added to system PATH.
4. Static LAN IP assigned to server PC (e.g. `192.168.1.100`).

### Installation Steps:
1. Open PowerShell as Administrator.
2. Navigate to project root:
   ```powershell
   cd D:\dr-sr
   ```
3. Run the offline installation script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\install.ps1
   ```
4. Verify created configuration file `backend\.env.production` (customize passwords and LAN bindings if needed).

---

## 2. Server Service Control & Scheduled Autostart (DEP-02)

### Starting the Server Manually:
Double-click `deploy\start-server.bat` or run:
```cmd
deploy\start-server.bat
```
The server will start at `http://0.0.0.0:8000`. Receptionists and Doctors can connect from any LAN workstation browser at `http://192.168.1.100:8000`.

### Stopping the Server:
Double-click `deploy\stop-server.bat`.

### Registering Autostart on Server Boot (Power Cut Recovery):
To ensure the hospital system starts automatically whenever the server PC is powered on:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\register-autostart.ps1
```
To unregister:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\unregister-autostart.ps1
```

### Health Monitoring Watchdog:
Run the health check script from command prompt or a recurring Windows task:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\health-check.ps1
```

---

## 3. Printer Setup Verification (PRN-01)

### 80mm Thermal Receipt Printer (POS-80):
1. Connect thermal printer via USB / Ethernet to Reception PC.
2. In browser print dialog:
   - Paper size: `80mm x Receipt` (or `Roll Paper 80 x 297 mm`).
   - Margins: `None` / `Minimum`.
   - Headers and Footers: `Uncheck`.
3. Verify print output:
   - Bilingual hospital header rendered crisply in Devanagari and English.
   - Formatted amount in Rupees (`₹`).
   - Reprint watermark `DUPLICATE` displays prominently across receipt when reprint is triggered.

### A4 Dual-Signature Patient Registration Card:
1. In browser print dialog from Patient Profile:
   - Paper size: `A4`.
   - Orientation: `Portrait`.
   - Margins: `Default`.
2. Verify:
   - Demographic block, URN barcode, and patient photo container.
   - Bottom dual signature boxes: "Patient / Attendant Signature" on left, "Authorized Signatory / Receptionist" on right.

---

## 4. Disaster Recovery Procedure (DEP-03)

### Creating an Ad-hoc Backup:
```cmd
backend\.venv\Scripts\python -m kalyan_api backup-create --label manual_ad_hoc
```
Or via the Administrator Web Dashboard at `/admin/backups`.

### Restoring from Backup Archive:
In the event of database corruption or hardware migration:
```cmd
backend\.venv\Scripts\python -m kalyan_api backup-restore D:\dr-sr\backend\var\backups\kalyan_backup_manual_ad_hoc_<timestamp>.tar.gz --safety-snapshot
```
The restore engine automatically creates a pre-restore safety snapshot, verifies SHA-256 bundle manifests, drops and re-creates clean database tables, and copies patient photographs into place.

### Verifying System Integrity:
```cmd
backend\.venv\Scripts\python -m kalyan_api integrity-check
```
Confirms financial ledger zero-balance discrepancies, receipt numbering sequences, URN uniqueness, treatment session count consistency, and patient photo file matching.
