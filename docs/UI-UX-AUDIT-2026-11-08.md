# Kalyan Hospital UI/UX Audit

**Audit date:** 8 November 2026  
**Scope:** React + TypeScript web application in `frontend/`  
**Revision inspected:** `2f58738` on `refactor/admin-modules-ssot`, with the existing uncommitted working-tree changes  
**Review basis:** Source review of 77 non-test TSX files and global CSS; manual inspection of role screenshots captured 6 November 2026; contrast ratios computed from the current source color values.  
**Overall result:** **15/24 — useful visual foundation, with accessibility and consistency work still needed.**

> This report is read-only review work. The working tree already contained unrelated product, test, planning, generated, and asset changes. No existing file was overwritten and no application code was changed.

## Executive summary

The authenticated workspace now has a **shared, standardized top header** for administrator, reception, and doctor roles. It uses the same white surface, hospital identity, address, time/location, user identity, role badge, and sign-out control. Differences are responsive visibility rules and role values rather than separate role-specific header designs. This is a sound direction and a clear improvement over maintaining independent headers.

The application has a recognizable burgundy-and-gold identity, meaningful brand and chart color variables, good dark/light surface separation, visible keyboard focus styles, reduced-motion support, and a persistent patient identity in the consultation workspace. In the source, the doctor’s department label is also derived from assigned departments; older screenshots that show “Physiotherapy Department” should not be treated as current behavior.

The key risks are **low-contrast form hints and control boundaries**, a modal mobile drawer without focus containment/restoration, a fragmented token system, frequent 12px interface text, and very small print on the patient registration card. The web app login is explicitly “authorized hospital staff only”; this audit found no patient portal route. Patient-facing use therefore needs a separate review of printed documents and/or a future patient interface.

## Six-pillar scorecard

| Pillar | Score | Finding |
|---|---:|---|
| Copywriting and task clarity | 3/4 | Role-based navigation and the newer concise labels are understandable. Clinical and administrative flows remain distinct. |
| Visual system and hierarchy | 3/4 | Strong, consistent hospital identity and clear card/form grouping; some screens remain dense and spacing/typography vary by page. |
| Color and contrast | 2/4 | Brand combinations are strong, but placeholders, some field borders, and the gold active marker miss common WCAG AA contrast thresholds. |
| Typography | 2/4 | One system font stack and Devanagari fallbacks are used, but small text dominates and many one-off pixel sizes remain. |
| Alignment and spacing | 3/4 | Shared shell, centered content container, aligned header groups, and generally consistent form/card patterns. A few pages use their own widths and compact controls. |
| Experience and accessibility | 2/4 | 44px targets and some good clinical identity safeguards; the mobile drawer’s modal semantics are not matched by focus handling, and patient-facing web tasks are absent. |

## 1. Top header bar and standardization

### Findings

- **Standardized across signed-in roles: yes.** One `<header>` is rendered by the shared `AppShell`; role-specific values are data in the same component. The 6 November admin, reception, and doctor captures show the same white institutional header treatment.
- The shared header is easy to scan: hospital/trust name and address on the left; time/location and signed-in identity on the right; sign-out as a separate control. The role is shown as text in a badge, so it is not communicated by color alone.
- The top bar is at least 56px tall and controls are given 44px minimum dimensions where needed. On narrow viewports, the menu button and sign-out remain; user identity and clock are intentionally hidden at small breakpoints. That saves space but means small-screen staff lose a persistent visible role/name confirmation.
- The active page is represented below the header by breadcrumbs, not inside the bar. The header itself has no patient identity; this is acceptable at the shell level because the clinical consultation workspace displays the current patient name and URN prominently in its own context header.
- The shell’s white header contrasts with the burgundy sidebar and pale workspace. In the doctor consultation route there is an additional sticky, dark clinical context bar for patient identity, save status, and encounter actions. This is useful and safer for clinical work, but it means route-level top chrome is not identical; treat it as a named secondary header pattern and align it to documented tokens.
- The header’s minimum height is 56px while the sidebar brand row uses 64px. This is a small vertical rhythm mismatch between the shared shell elements.
- The screenshots are from 6 November, while the inspected source contains later uncommitted changes. They confirm the shared header pattern, but they do not prove the exact latest runtime state.

### Recommendations

1. Keep a single shared header component and shared layout contract across all staff roles. Continue passing role/name/branding as data rather than branching into role-specific markup.
2. Define the header’s vertical rhythm once (for example, a 60–64px desktop bar and an appropriately compact mobile bar) and align the sidebar brand row with it.
3. At mobile widths, preserve at least the user’s role or a clear account control label; ensure the user can identify the active workspace without opening the menu.
4. Keep patient identity in the consultation context area, as currently implemented. Maintain a prominent “No patient selected” state and avoid showing patient information in unrelated administrative pages.
5. Document the dark clinical context bar as a secondary workflow header, with explicit hierarchy, color, spacing, and responsive rules.
6. After the in-progress changes settle, recapture all three roles at desktop and mobile widths and verify the rendered app—not just `AppShell` source.

## 2. Color system and contrast

### Findings

- The core brand is coherent: burgundy (`#5D0B26` / `#8E1C3D`), gold accents, white surfaces, and a pale cool-gray workspace. Brand text against white is strong: `#5D0B26` on white is **13.62:1**; `#8E1C3D` on white is **8.81:1**. Standard muted slate text (`#64748B`) on white is **4.76:1**.
- `index.css` now defines brand, gold, danger, chart-series, and consultation-status colors. That is a useful foundation. However, a scan of the 77 non-test TSX files still found **407 literal six-digit hex color occurrences and 56 distinct hex values**. Component colors are therefore only partly governed by the central palette.
- The consultation workspace uses a separate dark navy canvas (`#0E131F` / `#0B132B`) and teal action colors, while most routes use white cards on a light-gray canvas. This may be an intentional clinical focus mode, but it is not represented as a documented theme and currently increases visual/context switching between routes.
- Representative accessibility checks against white:

| Pair in current source | Ratio | WCAG AA check | Result |
|---|---:|---:|---|
| Slate 400 placeholder `#94A3B8` | 2.56:1 | 4.5:1 text | Fail |
| Slate 300 input border `#CBD5E1` | 1.48:1 | 3:1 UI boundary where needed | Fail |
| Gold active marker `#C39A35` | 2.63:1 | 3:1 non-text indicator | Fail |
| Muted patient ID/section text `#64748B` on clinical navy `#0B132B` | 3.86:1 | 4.5:1 text (12px) | Fail |
| Burgundy `#5D0B26` | 13.62:1 | 4.5:1 text | Pass |
| Brand `#8E1C3D` | 8.81:1 | 4.5:1 text | Pass |
| Slate 500 `#64748B` | 4.76:1 | 4.5:1 text | Pass |
| Focus burgundy `#9E1B42` | 7.81:1 | 3:1 focus contrast | Pass on white |

- Some form borders are the only visual boundary separating inputs from white cards. Their contrast should be increased rather than relying on the field fill alone. A focus ring helps only while focused; it does not resolve the resting-state boundary.
- The gold selected-navigation strip is paired with a white selected row and readable text. The selected state remains understandable, but the decorative strip by itself is below a 3:1 contrast target. A darker gold token (`#A88328`, measured 3.53:1 on white) is already available.
- Status colors should continue to be paired with labels/icons. Keep danger red separate from brand burgundy and success green separate from both; color alone should not identify clinical or billing status.

### Recommendations

1. Complete a three-layer palette: primitive values → semantic roles (text, surface, border, focus, success, warning, danger) → component use. Migrate repeated raw values to those semantics.
2. Replace placeholder text with a darker neutral that reaches at least 4.5:1 on its actual background. Keep visible labels as the primary field name; placeholders should be examples or hints only.
3. Use a field-border token that reaches at least 3:1 against adjacent surfaces when the border is needed to identify the control. Check both white cards and tinted surfaces.
4. Change the navigation active marker to the existing darker gold or add a shape/position cue with sufficient contrast.
5. Create a documented dark clinical theme using the same semantic token roles, and retune muted patient/section text to at least 4.5:1 on its dark background.
6. Validate all state pairs—default, hover, focus, disabled, error, success, selected—on both light and dark surfaces, including chart series and appointment states.

Contrast criteria are based on [WCAG 2.2, Contrast Minimum](https://www.w3.org/TR/WCAG22/#contrast-minimum) and [Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast).

## 3. Typography and readability

### Findings

- The global stack is system-native and includes Nirmala UI and Noto Sans Devanagari fallbacks, which supports Hindi/English hospital content without requiring a remote font. The same global family is inherited across the app.
- Text is concentrated at compact sizes: source scan found **869 `text-xs` uses (12px)** and **676 `text-sm` uses (14px)**. This density is visible in header metadata, navigation, table labels, helper text, and some forms. Twelve-pixel type can be appropriate for secondary metadata, but it is too small as the routine size for clinical data-entry labels, key status, or patient instructions—especially on older monitors and under low-vision conditions.
- Page-title patterns are mostly 24px bold, but headings also use 16px, 20px, 30px, 32px, and one-off pixel values. There are at least **51 arbitrary pixel font-size declarations** in TSX. This weakens predictable hierarchy and makes future scaling harder.
- Printed patient card text falls to 9–10px, including the footer instructions and signature labels. This is the clearest patient-facing readability issue.
- Hindi is explicitly marked in several places, but use of `lang="hi"` is not universal for Hindi text in the patient card and other printed output. Incorrect language announcements can impair screen-reader pronunciation.
- The patient ID and “Current consultation” captions in the dark clinical context bar use `text-slate-500` at 12px; that color measures **3.86:1** against `#0B132B`, below the 4.5:1 normal-text target.

### Recommendations

1. Establish a small type scale (for example 12, 14, 16, 18, 24, 32px) and semantic roles for display, page title, section title, body, field label, helper, and metadata.
2. Set 16px as the default for body and important form content; reserve 12px for secondary metadata and dense tabular labels after verifying legibility at actual workstation distance.
3. Define consistent heading levels and styles. Each route should have one meaningful page-level heading, followed by properly nested section headings.
4. Increase registration-card instructions, signature labels, and critical patient identifiers to a legible print size; confirm on the actual card stock and printer because browser pixels do not guarantee physical readability.
5. Mark all Hindi/English passages with the appropriate `lang` attribute and test mixed-language screen-reader output.
6. Raise low-emphasis clinical-context text to a dark-theme neutral that meets 4.5:1; keep secondary text visually subordinate through size/weight and spacing rather than insufficient contrast.

## 4. Alignment, spacing, and layout

### Findings

- `AppShell` gives routes a consistent main content alignment and a shared maximum width. The header uses left/right flex groups; the content, breadcrumbs, and footer use matching horizontal bounds. This creates a stable frame across the staff app.
- The clinical consultation workspace narrows its working content and splits the form/context panel at wider breakpoints, which is appropriate for reducing long-line scanning and keeping patient context available.
- The source uses common Tailwind spacing and rounded-card patterns, but page-level layouts still vary in horizontal padding and width. The global shell allows up to 1720px while some pages use `max-w-7xl` or their own nested `main` wrappers. At wide resolutions this may lead to inconsistent content edges and long table/text lines.
- The 6 November admin screenshot shows both a sidebar navigation scroll area and a separate main-content scroll bar. That is necessary for the tall admin navigation but creates nested scrolling; keyboard and trackpad users should be checked for predictable scroll focus.
- Some dense lists and data-entry forms use 12px controls/text and tight vertical grouping. That saves screen space but can raise selection errors during fast reception or clinical workflows.

### Recommendations

1. Define shared page gutters, content widths, card spacing, and form-grid breakpoints. Use a narrower reading width for prose and a wider data width only for tables/dashboards.
2. Align page titles, tabs, filters, tables, and primary actions to the same container edge on each route.
3. Increase vertical separation around high-risk actions (finalize consultation, reverse payment, restore backup) and keep destructive actions visually separated from ordinary primary actions.
4. Verify the nested sidebar/main scrolling with keyboard, mouse wheel, and trackpad, particularly at 200% zoom and at 768px and 1024px widths.
5. Ensure long labels wrap or expose the full text on keyboard focus; avoid truncating clinical terms where ambiguity could affect care.

## 5. Accessibility and clinical workflow usability

### Strengths

- Global `:focus-visible` styling and `prefers-reduced-motion` handling are present. The main shell uses semantic header, navigation, main, and footer elements.
- Header actions and navigation links expose accessible names; decorative icons are generally hidden from assistive technology. Primary touch controls often have 44px minimum height.
- The mobile menu has dialog semantics, a close control, and Escape handling.
- The consultation workspace shows the patient name and patient ID/URN in a prominent context area and explicitly shows a no-patient state. This is an important wrong-patient prevention cue.
- Login inputs have visible labels, autocomplete attributes, password visibility control, and announced login errors.

### Findings

- The mobile navigation is marked `role="dialog"` and `aria-modal="true"`, but source inspection shows no focus trap, no initial focus placement, and no focus restoration to the menu button on close. Keyboard users can tab to background controls while the dialog claims the background is modal. Escape handling is present but does not solve this.
- A skip link to the main content was not found. Keyboard users must tab through the shared header and sidebar on every route.
- Placeholder and border contrast failures are described above. These affect users with low vision, color-vision deficiency, or bright/low-quality clinic displays.
- The global shell has `overflow: hidden` on the root and uses internal scrolling. That can be workable, but reflow, browser zoom, and small-screen operation need a hands-on check to ensure content does not become unreachable.
- Clinical tasks and administrative settings have different consequences. High-impact actions need clear confirmation/recovery, explicit labels, and a patient/transaction identity immediately adjacent to the action. The available screenshots are not current enough to validate every such flow.

### Recommendations

1. Make the mobile drawer a fully managed modal: move focus into it, keep Tab/Shift+Tab inside, close on Escape, restore focus to the trigger, and prevent background interaction while open.
2. Add a visible-on-focus “Skip to main content” link and a stable `id` target on the shell’s main region.
3. Check all status messages and async updates for screen-reader announcement (`role="status"` or a suitable live region) without moving focus unexpectedly.
4. Perform manual keyboard-only, NVDA/JAWS, browser zoom (200%), and high-contrast mode checks on login, patient search/registration, consultation, billing, and modal flows.
5. For clinical finalization and financial reversals, show the patient/transaction identifier, consequences, and recovery path before confirmation. Keep an audit trail in the workflow.

## 6. Patient and staff user needs

The current login explicitly restricts access to authorized hospital staff, and route structure is organized around admin, reception, and doctor roles. **No patient portal was found in the current frontend routes.** The system may still serve patients through the registration card, prescription/receipt prints, and staff-assisted check-in, but the patient’s end-to-end digital experience cannot be rated from this web UI.

For staff, prioritize speed without sacrificing patient identity: searchable patient records, clear queue state, stable patient context during charting, keyboard access, readable fields, and recovery from interruptions. The current consultation context header is a positive pattern to preserve.

For patients who receive printed output, prioritize readable type, plain-language visit/payment instructions, legible dates and contact information, Hindi language tagging, and print checks at actual size. If a patient-facing portal or kiosk is planned, audit it separately for low literacy, Hindi-first workflows, mobile access, screen readers, and caregiver-assisted use.

## 7. Top-priority improvements

| Priority | Recommendation | Why |
|---|---|---|
| P0 | Darken placeholder text and field borders; raise active gold marker contrast | Direct visual-accessibility failures on routine forms/navigation. |
| P0 | Implement complete focus management for the mobile modal drawer | Modal currently exposes background controls to keyboard navigation. |
| P1 | Increase clinical form text and patient print text; unify type scale | Reduces reading fatigue and patient misinterpretation. |
| P1 | Expand semantic token coverage and migrate repeated raw colors | Makes accessible states easier to maintain consistently. |
| P1 | Add skip link and run keyboard/screen-reader/zoom review on critical routes | Improves navigation access and verifies workflow safety. |
| P2 | Standardize content widths/gutters and validate nested scroll behavior | Reduces visual drift between routes and improves navigation under zoom. |
| P2 | Audit patient-facing printed artifacts and define patient portal scope | The current web app is staff-only, so patient-facing needs otherwise remain unverified. |

## 8. Validation limits

- This was a source review plus inspection of role screenshots dated 6 November; the screenshots predate some current uncommitted source changes. No fresh authenticated session against the current backend was available for this audit.
- Contrast ratios were calculated for the exact source colors listed in the report. Other dynamic, opacity-blended, chart, alert, and print combinations still need automated and visual verification.
- NVDA/JAWS, keyboard-only, 200% zoom, mobile device, printer, and real patient usability sessions were not performed. Scores are audit findings, not a formal WCAG conformance statement.
- Current design guidance reference: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) and the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
