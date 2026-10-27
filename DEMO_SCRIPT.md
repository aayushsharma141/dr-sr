# Kalyan Hospital Management System — 5-Minute Client Demonstration Script

> **Audience:** Dr. Madan Mohan Dwivedi (Senior Physiotherapist) & Dr. Chandan Kr. Dwivedi (Physiotherapist)  
> **Target Workstation:** Single Windows PC, 100% Offline (No Internet Required)  
> **Demo Duration:** 5 minutes  
> **Key Objective:** Prove the system reproduces the hospital's authentic physical workflow, prescription slip branding, and clinical ledger without cloud subscriptions or technical complexity.

---

## Pre-Demo Preparation (15 Seconds Before Meeting)

1. Launch the application:
   - **Option A (Easiest):** Double-click `run.bat` in the project folder.
   - **Option B (PowerShell):**
     ```powershell
     .\.venv\Scripts\python.exe main.py
     ```
2. Open **"Local Backup & Data Safety"** in the sidebar.
3. Click **"⚡ Reset Demo Data"** and enter the admin password: `kalyan@admin`.
   - *Result:* In < 1 second, the database is reset with 5 realistic patients, active treatment cases, and payment records.
4. Click **"Dashboard"** in the sidebar. You are ready!

---

## 5-Minute Walkthrough Flow

```
[00:00 - 01:00]  Minute 1: Hospital Identity & Live Executive Dashboard
[01:00 - 02:00]  Minute 2: Patient Intake, Photo Box & Instant Multi-Field Search
[02:00 - 03:00]  Minute 3: Physiotherapy Treatment Cases & Chronological Session Log
[03:00 - 04:00]  Minute 4: Field 12 Currency-Safe Billing & Dynamic Balance
[04:00 - 05:00]  Minute 5: Authentic A4 Slip Print Preview, PDF Export & Hot Backup
```

---

### Minute 1: Hospital Identity & Live Dashboard (00:00 – 01:00)

**What the Doctors See:**
- Official Deep Maroon (`#6B1736`) sidebar with **श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित** and **KALYAN HOSPITAL**.
- Real-time stat cards queried directly from SQLite:
  - Total Registered Patients (5 Patients)
  - Active Physiotherapy Cases (5 Cases)
  - Sessions Conducted (13 Sessions)
  - Total Fee Collections (₹10,800.00)

**What to Say to the Doctors:**
> *"Doctor Sahab, this application is custom-built exclusively for Kalyan Hospital. It operates 100% offline right on your clinic PC — no internet required, and zero recurring monthly cloud fees.*  
> *Here on the dashboard, you see real-time clinic numbers computed directly from your local database."*

---

### Minute 2: Patient Registration & Instant Search (01:00 – 02:00)

**What to Do:**
1. Click **"Patient Directory"** on the sidebar.
2. In the search box, type `Ramesh` or `9876` or `KH-2026-0001`.
   - *Result:* The table filters instantly (< 50ms) as you type.
3. Click **"➕ Register New Patient"**.
4. Show the form fields matching canonical prescription slip fields 1–10:
   - Field 1: Sequential URN (`KH-2026-0006`)
   - Field 2: Patient Name
   - Fields 3 & 4: Age & Sex
   - Field 5: Address
   - Field 6: 10-Digit Mobile Number
   - Fields 7 & 8: Patient In / Out timestamps
   - Field 9: Referred By
   - Field 10: Patient Condition
   - Patient Picture box with file selector.

**What to Say to the Doctors:**
> *"Every patient receives a unique, sequential hospital ID like KH-2026-0001. Reception can find any patient record in under a second simply by typing the patient's name, phone number, or URN number."*

---

### Minute 3: Physiotherapy Treatment Cases & Session Notes (02:00 – 03:00)

**What to Do:**
1. In the Patient Directory, click **"🩺 Session"** next to **Ramesh Kumar Sharma**.
2. Show the **Treatment Cases** screen:
   - Case Title: *Lumbar Spondylosis Rehabilitation*
   - Field 11 Sessions Progress: **"3 of 10 sessions completed (30%)"** with a visual progress bar.
   - Chronological Sessions Log:
     - Session 1, 2, 3 with timestamps, therapist name (**Dr. Madan Mohan Dwivedi** / **Dr. Chandan Kr. Dwivedi**), clinical notes, modalities (Lumbar Traction, IFT), and VAS pain scores (8/10 → 6/10 → 4/10).
3. Click **"📝 Log Session"**:
   - Show auto-incremented Session #4.
   - Select modalities checkboxes (*Traction*, *Therapeutic Exercise*).
   - Enter notes: *"Patient reports 70% pain relief. Active extension exercises performed."*
   - Click **Save Session Record**.

**What to Say to the Doctors:**
> *"For each patient, you can track multiple treatment packages. As treatments progress, you can log each session chronologically with specific modalities (IFT, Traction, Ultrasound) and track pain score reduction from 8 down to 4. Previous notes are permanently preserved."*

---

### Minute 4: Currency-Safe Billing Ledger & Real-Time Balance (03:00 – 04:00)

**What to Do:**
1. Click **"💳 View Financials & Ledger"** or open **"Billing & Payments"** in the sidebar.
2. For *Ramesh Kumar Sharma*:
   - Total Agreed Fee: **₹ 3,500.00**
   - Amount Paid to Date: **₹ 1,500.00**
   - Remaining Balance Due: **₹ 2,000.00** (prominently styled in Deep Maroon).
3. Enter a partial installment:
   - Amount: `₹ 1,000.00`
   - Mode: `UPI`
   - Reference Note: `GPay Ref #567890`
   - Click **"💾 Save Payment"**.
4. Show the updated balance:
   - Amount Paid updates to **₹ 2,500.00**.
   - Remaining Balance drops to **₹ 1,000.00**.
5. Switch to **Sunita Devi**:
   - Show **"₹ 0.00 (CLEARED ✓)"** in vibrant green badge.

**What to Say to the Doctors:**
> *"In Field 12, all billing uses exact integer paise arithmetic — so there are zero floating-point rounding errors. Whether a patient pays in full upfront or makes 3 partial installments via Cash or UPI, the balance recalculates automatically. When cleared, the card turns green."*

---

### Minute 5: A4 Prescription Slip Printout & Hot Local Backup (04:00 – 05:00)

**What to Do:**
1. Return to **Patient Directory**, click **"🖨️ Print"** next to *Ramesh Kumar Sharma*.
2. The native **Print Preview Dialog** appears:
   - Deep Maroon `#6B1736` header with **श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित**.
   - Both clinic branch addresses (Nawada Thana, Ara & Srirampur Road, Gadhani).
   - Doctor credentials (**Dr. Madan Mohan Dwivedi** & **Dr. Chandan Kr. Dwivedi**).
   - 35mm × 45mm Patient Picture box.
   - All 12 canonical fields neatly structured.
   - Dual bottom signatures: **Patient / Attendant Signature** and **Authorized Signature** with **Date**.
3. Close the preview dialog.
4. Click **"Local Backup & Data Safety"** on the sidebar:
   - Click **"💾 Create Backup Now"** → Backup snapshot created in < 50ms.
   - Click **"🔍 Verify"** on the latest snapshot → Shows **Integrity Check: PASSED ✓**.

**What to Say to the Doctors:**
> *"With one click, reception can print an official A4 registration slip that looks identical to your physical pad — complete with your trust banner, both Ara and Gadhani addresses, both doctor credentials, and dual signatures. You can also export it directly to PDF.*  
> *Finally, your data is 100% safe: you can create an instant backup anytime, and restoring is protected by your administrator password."*

---

## Common Client Questions & Answers

| Doctor Question | Recommended Answer |
|---|---|
| **"What if the internet goes down?"** | *"The software runs 100% locally on your computer. It never connects to the internet, so power cuts or broadband outages will never stop you from registering patients or viewing clinical records."* |
| **"Are there any monthly or yearly subscription fees?"** | *"None. There are zero recurring cloud subscription costs. You own the software and all patient data resides safely on your clinic PC."* |
| **"Can we print on our existing clinic printer?"** | *"Yes! Any standard Windows laser, inkjet, or thermal printer is supported directly through the Windows print system."* |
| **"How do we prevent staff from accidentally wiping data?"** | *"Database restoration and demo resets are protected by PBKDF2 administrator password encryption. Regular reception staff cannot overwrite records."* |
