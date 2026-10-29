---
phase: "01"
slug: "app-shell-dashboard"
status: approved
shadcn_initialized: false
preset: "Healthcare Clinical Desktop / UI-UX-PRO-MAX"
created: "2026-10-28"
---

# Phase 01 — UI Design Contract (UI-UX Pro Max Standard)

> Visual and interaction contract for Kalyan Hospital Desktop Patient Management System. Generated following UI-UX-PRO-MAX design intelligence standards.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | PySide6 (Qt 6) Native Desktop GUI |
| Preset | Healthcare Clinical Desktop System |
| Component library | Custom Hospital QSS Design Token Suite (`app/ui/styles.py`) |
| Icon library | Native Unicode Clinical Glyphs + High-DPI Qt Rendering |
| Font | `"Segoe UI", "Nirmala UI", -apple-system, sans-serif` |

---

## Component Inventory

Enumerated from `app/ui/` codebase — 11 core view and container components — PySide6@6.8.0.2 — 2026-10-28.

| Component | Import path | Notes |
|-----------|-------------|-------|
| `MainWindow` | `app.ui.main_window` | Top-level window shell with central split layout (`CentralWidget`). |
| `SidebarWidget` | `app.ui.sidebar` | 240px persistent trust-green navigation bar with authentic Hindi/English branding. |
| `DashboardView` | `app.ui.views.dashboard_view` | Real-time metric cards, quick-action shortcuts, and admissions summary. |
| `PatientModuleView`| `app.ui.views.patient_module_view` | Tabbed wrapper toggling between intake form and searchable registry. |
| `PatientFormView` | `app.ui.views.patient_form_view` | 12-field clinical intake form with portrait photo picker & inline validation. |
| `PatientListView` | `app.ui.views.patient_list_view` | Instant search registry table (<50ms filter) with action row triggers. |
| `TreatmentView` | `app.ui.views.treatment_view` | Clinical cases timeline, session logger, and pain progression tracker. |
| `PaymentView` | `app.ui.views.payment_view` | Integer-paise billing ledger, installment recorder, and dynamic balance badge. |
| `BackupView` | `app.ui.views.backup_view` | One-click hot backup, integrity verification, and demo data reset. |
| `AdminAuthDialog`| `app.ui.views.auth_dialog` | PBKDF2 password gate modal guarding sensitive operations. |
| `DocumentBuilder` | `app.services.document_builder` | ISO A4 prescription slip generator matching Kalyan Hospital physical card. |

---

## Spacing Scale

Declared values (consistent 4px/8px multiples):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Inline icon gaps, badge padding, compact status dots |
| sm | 8px | Button vertical padding, input inner padding, table cell padding |
| md | 12px | Form field row spacing, card sub-element gaps |
| lg | 16px | Stat card inner padding, navigation button padding, dialog button row |
| xl | 20px | Main window content gutters, sidebar header margins |
| 2xl | 24px | Section separation on dashboard, card panel margins |
| 3xl | 32px | Major operational breaks |

Exceptions: Fixed 240px left sidebar width, 120x140px portrait photo box.

---

## Typography

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Display | 26px | 700 (Bold) | 1.1 | Stat card numeric metrics (`#StatCardValue`) |
| Heading 1 | 20px | 700 (Bold) | 1.2 | Module page headers (`#PageHeading`) in slate (`#202B33`) |
| Heading 2 | 16px | 700 (Bold) | 1.25 | Sidebar Hindi title (`#SidebarTitle`), Dialog titles |
| Body Bold | 14px | 600 (Semi) | 1.4 | Form inputs (`QLineEdit`), Table headers, Primary CTA text |
| Body Base | 13px | 400 (Regular) | 1.45 | Application base text, navigation labels, table rows |
| Caption | 11px–12px | 500 (Medium) | 1.3 | Stat subtitles, clinical qualifiers, field hints |
| Legal / Micro | 10px | 400 (Regular) | 1.2 | Trust registration statement (`#SidebarTrust`), version stamp |

*Devanagari Fallback:* Explicitly specifies `"Nirmala UI"` after `"Segoe UI"` to ensure full conjunct rendering for Hindi text across all Windows editions.

---

## Color

60/30/10 Trust-Led Clinical Palette:

| Role | Value | Usage |
|------|-------|-------|
| Dominant Canvas (60%) | `#F5F7F5` / `#FFFFFF` | Low-glare work canvas and crisp card surfaces. |
| Structural Identity (30%) | `#155B43` / `#104735` | Sidebar, primary actions, selected navigation and brand anchors. |
| Supporting Identity | `#234B86` | Secondary actions, links and informational accents. |
| Heritage Highlight | `#C39A35` | Small brand details only; never large background fills. |
| Clinical Interaction | `#0D9488` | Focus rings, input focus, interaction and selection highlights. |
| Primary Text | `#202B33` | Patient and clinical data text. |
| Borders | `#DDE5DF` | Tables, forms, separators and cards. |
| Financial Liability | `#B42318` | Outstanding dues, errors and destructive warnings. |
| Financial Settled | `#16734A` | Zero balance and verified backup success. |
| Operational Warning | `#A16207` | Overpayment warnings and unverified restore snapshots. |

Accent reserved for:
- Input `:focus` border (`#0D9488`)
- Active navigation marker (soft teal `#5EEAD4`)
- Text selection highlights (`selection-background-color: #0D9488`)
- Hover state on primary and secondary actions

The physical A4 prescription retains maroon (`#6B1736`) to match the supplied pad; maroon is not the dominant application-shell color.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary Patient CTA | `"Save Patient Record"` |
| Primary Session CTA | `"Save Session Record"` |
| Primary Payment CTA | `"Save Payment"` |
| Quick Registration | `"+ Register New Patient"` |
| Empty Patient Search | `"No records matching '{query}'."` |
| Empty Patient Registry | `"Patient registry is empty. Click 'Register New Patient' to add records."` |
| Empty Treatment Case | `"No Active Treatment Case"` |
| Empty Photo Box | `"No Photo Selected"` |
| Inline Form Error Banner | `"• {field_name}: {validation_error_description}"` |
| Destructive Reset Action | `"Reset Demo Data": "Warning: This replaces current records with synthetic demo patients. Proceed?"` |
| Administrative Guard | `"Administrator Authorization Required": "Enter admin password to proceed with {action}."` |

---

## UI Considerations

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| Empty State | Patient Registry Table | ✅ covered | Displays empty prompt directing user to click Register New Patient. |
| Empty State | Treatment Session Log | ✅ covered | Displays "No Active Treatment Case" badge and prompts case opening. |
| Filter State | Search Bar | ✅ covered | Character-by-character instant filter updates table within 50ms. |
| Inline Validation| Patient Form View | ✅ covered | Highlights invalid field in red and displays multi-line error banner. |
| Modal Protection | Database Restore & Demo Reset | ✅ covered | PBKDF2 password challenge prevents unauthorized overrides. |
| Visual Contrast | Left Sidebar | ✅ covered | Trust green (`#104735`) background with WA_StyledBackground guarantees high contrast against white text. |
| High-DPI Scale | All Views | ✅ covered | Qt high-DPI scaling enabled; scalable layouts with auto-expanding gutters. |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS (100% offline, zero third-party cloud telemetry)
- [x] Dimension 7 Inventory Provenance: PASS (enumerated from PySide6 views)

**Approval:** Approved 2026-10-28 (UI-UX Pro Max Standard Verified)
