# Phase 20: Admin Data Governance & Asset Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-07 to 2026-11-08
**Phase:** 20-admin-data-governance-asset-management
**Areas discussed:** Todos, Import rules, Export limits, Demographic correction, Sidebar sections

---

## Todos

| Option | Description | Selected |
|--------|-------------|----------|
| Keep it separate | Checkout is its own billing feature; fix the requirements mapping | ✓ |
| Fold it into Phase 20 | Adds counter items, visit ledger and checkout screen | |

**User's choice:** Keep REC-05 to REC-08 separate.

---

## Import rules

| Question | Options | Selected |
|----------|---------|----------|
| Data source | Paper registers in Excel / v2.0 desktop data / Both / Not known yet | Not known yet |
| URN | New URN, keep old number / New URN, drop old number / Preserve existing KH- URNs | New URN, keep old number |
| Missing required field | Block until fixed / Allow 'Unknown' placeholders | Block until fixed |
| Commit | All or nothing / Import what's valid | Import what's valid |
| Undo | Safety backup, no undo / Deactivate batch action | Safety backup, no undo |
| Duplicates | Skip or import as new / Skip only | Skip or import as new |

**Notes:** Combining "block until fixed" with "import what's valid" means a row with gaps stays out and is listed, without blocking the rest of the batch.

---

## Export limits

| Question | Options | Selected |
|----------|---------|----------|
| Clinical fields | Never exportable / Exportable with a reason | Exportable with a reason |
| Allergies and notes | Exclude both / Offer, unticked by default | Offer, unticked by default |
| Department scope | Patients with an appointment there / Drop department scope | Patients with an appointment there |
| File storage | Download only, nothing stored / Keep on server | Download only |
| Until D-04 sign-off | Build it switched off / Hold Plan 20-07 / Treat it as approved now | Treat it as approved now |
| Clinical fields covered | Summary only / Summary plus prescriptions / Everything clinical | Everything clinical |
| Extra safeguards | Separate audit, longer reason / Same as a normal export | Same as a normal export |

**Notes:** Claude warned that D-04 is locked with the trust administrator as owner and that no written agreement is in the repo. The user chose to treat it as approved. It is recorded as the user's decision.

---

## Demographic correction

| Question | Options | Selected |
|----------|---------|----------|
| Reception's edit | Add Admin route, reception unchanged / Lock identity fields from reception | Add Admin route, reception unchanged |
| Fields | All demographics except URN / Roadmap four only | All demographics except URN |
| Permission | Add Admin-only entries / Reuse settings:write / Give Admin patient:update | Add Admin-only entries |
| Old prints | Corrected details / Details as originally issued | Details as originally issued |
| Which documents store details | Receipts only / Receipts, prescriptions, summaries | Free text: "i want every patient will by its urn , mob no, + address" |
| Existing receipts | Fill in at migration / Leave blank, use current | Free text: "dont show reprint" |

**Clarification round:**
- "every patient ... by its urn, mob no, + address": clarified as **Both**. Printouts show and store URN, mobile and address at issue, and import uses mobile and address to flag duplicates.
- "dont show reprint": clarified as **Keep reprints, fixed details**. A reprint never shows corrected details, and existing receipts get their details filled in by the migration.

---

## Sidebar sections

| Question | Options | Selected |
|----------|---------|----------|
| Fifth section | Billing & Finance / Overview / Reports | Billing & Finance |
| Placeholder links | Remove them / Keep, marked 'coming soon' | Remove them |
| Base for 20-02 | Build on uncommitted changes / Start from main | Build on them |
| Patient lookup | Own search in correction page / Link reception directory | Own search |

---

## Claude's Discretion

- Logo and reprint history, and print template scope: offered as areas, not picked by the user; Claude's defaults were stated and accepted.
- Import file limits, encoding, XLSX library, staging retention; export streaming and formula neutralising.

## Deferred Ideas

- Duplicate merge, bulk archive, bulk delete: Phase 21.
- Real reports replacing the removed placeholder links.
- Eye doctor on the letterhead doctor block.
