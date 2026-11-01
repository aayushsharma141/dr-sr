# Deployment Runbook — Kalyan Hospital v3.0

**Status:** Target runbook; deployment not yet tested. Hardware and client approvals pending.

## 1. Topology

One central on-premises server hosts the frontend, FastAPI service, PostgreSQL database, private patient files, logs and backup scheduler. Three to five clinic PCs access the server through browsers on the hospital LAN. Internet is not required for normal operation.

## 2. Before installation

Confirm and record:
- Server make/model, CPU, RAM, storage health and operating system.
- Fixed/reserved LAN IP and hostname.
- UPS capacity and controlled shutdown behavior.
- Client PC/browser compatibility.
- Actual A4 printer model, driver and test paper.
- Backup target drive, capacity, ownership, schedule and retention.
- Whether HTTPS is mandatory for first release.
- Approved staff accounts, roles and doctor access policy.

Do not proceed with production patient data until server ownership, access control and backup target are agreed.

## 3. Installation sequence

1. Install supported OS updates and required offline packages.
2. Create a dedicated non-administrator service account.
3. Install PostgreSQL and create a least-privilege application database/user.
4. Apply versioned schema migrations.
5. Install backend dependencies from pinned offline artifacts.
6. Build frontend assets locally; do not rely on CDN or remote fonts.
7. Configure environment secrets outside source control with restrictive filesystem permissions.
8. Configure private patient file directory and backup destination.
9. Configure firewall to allow only required service ports from the trusted LAN.
10. Start application services and verify health checks.
11. Complete one-time administrator setup using code printed to local server console.
12. Create staff accounts; require password changes where applicable.
13. Verify client PCs can access the application with internet disconnected.

Exact commands, ports, OS service units and supported versions must be added after the implementation stack and server OS are selected.

## 4. First-run administrator setup

- Confirm no administrator exists.
- Start backend locally and obtain one-time setup code from server console.
- Use browser setup wizard from an authorized workstation.
- Create the first administrator with a unique password.
- Verify setup code cannot be reused and public setup endpoint is disabled.
- Test second simultaneous or subsequent setup request fails.
- Store recovery procedure securely with hospital administrator.

Never place setup code, passwords or production secrets in README, source, issue comments or screenshots.

## 5. LAN and firewall

- Server has stable IP.
- Clients and server are on approved private subnet.
- No router port forwarding or public exposure.
- Permit only required ports from trusted subnet.
- HTTPS is preferred. Any HTTP exception requires explicit written client approval and must be recorded as unencrypted.
- Confirm all app assets and workflows work without internet.

## 6. Service recovery

Configure backend and database services to start automatically after reboot. Use health checks, bounded restart policy and local logs. Test:
- Server reboot.
- Power loss simulation under controlled conditions.
- LAN cable disconnect/reconnect.
- Client browser restart.
- Database service restart.
- Full disk warning and backup target unavailable.

UPS is strongly recommended; software cannot guarantee recovery from failing hardware or abrupt storage failure.

## 7. Backup operations

- Schedule database + patient-file backup.
- Write to second physical drive.
- Verify checksums after each run.
- Show last successful verified backup and failure state to Admin.
- Retain backups according to client-approved schedule.
- Perform clean-machine restore drill before handover and periodically thereafter.

## 8. Handover checklist

- [ ] Server and network details documented.
- [ ] Admin bootstrap completed; recovery procedure handed to authorized owner.
- [ ] Individual staff accounts and roles verified.
- [ ] Internet disconnected; workflows remain functional.
- [ ] 3–5 client PCs tested.
- [ ] Unauthorized API and file access denied.
- [ ] Actual A4 printer output approved.
- [ ] Backup bundle includes database and patient files.
- [ ] Restore on clean machine completed and checksums/integrity report reviewed.
- [ ] Auto-start and recovery after reboot tested.
- [ ] Staff trained on registration, clinical workflow, receipts and escalation.
- [ ] Client signs acceptance and records unresolved limitations.

---
*Do not use this runbook as evidence of deployment until every applicable checklist item has been tested and recorded.*