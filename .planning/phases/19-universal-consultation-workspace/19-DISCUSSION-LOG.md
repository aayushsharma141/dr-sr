# Phase 19: Universal Consultation Workspace - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-05
**Phase:** 19-universal-consultation-workspace
**Areas discussed:** Scope and base, Consultation layout, Template fields, Prescription details, Follow-up booking, Auto-save behaviour, Printed summary, One login at a time

Run by hand from the discuss-phase workflow, because `gsd-tools` could not run in this checkout (runtime library not built).

---

## Scope and base

| Question | Options | Selected |
|----------|---------|----------|
| Reception spec v1.1 or today's decision on specialty forms | Include in Rs 22,000; Price them separately | Include in Rs 22,000 |
| Phase 19 base | Merge both first; Merge PR #17 only; Build on main now | Merge both first |

---

## Consultation layout

| Question | Options | Selected |
|----------|---------|----------|
| Structure | One page with sections; Tabs; Step-by-step; You decide | One page with sections |
| Side panel | Patient, allergies, last visit; Patient and allergies only; Full patient history | Patient, allergies, last visit |
| Follow-up reuse | Read only, copy on request; Read only, no copy | Read only, copy on request |
| Finalise requires | Complaint, diagnosis, required template fields; Complaint and diagnosis only; Every section | Complaint, diagnosis, required template fields |

---

## Template fields

| Question | Options | Selected |
|----------|---------|----------|
| Physiotherapy sections | Pain assessment; Range of motion; Strength and function; Posture and gait | All four |
| Ophthalmology sections | Visual acuity; Intraocular pressure; Anterior segment; Fundus and refraction | All four |
| Field style | Structured where it counts; Mostly free text; Fully structured | Structured where it counts |
| Review | Draft, then doctors review; Doctors supply the lists first | Draft, then doctors review |

---

## Prescription details

| Question | Options | Selected |
|----------|---------|----------|
| Extra fields | Strength; Form; Route; Quantity | No preference given |
| Authorising | Separately, before finalising; Together with finalising | Separately, before finalising |
| Correction | Cancel with reason, reissue; Addendum note only | Cancel with reason, reissue |
| Old page | Retire creation, keep history; Keep both | Retire creation, keep history |

---

## Follow-up booking

| Question | Options | Selected |
|----------|---------|----------|
| Who books | Reception books it; Doctor books it too | Doctor books it too (against the recommendation) |
| Reception sees | Date and doctor only; Add a booking note; Show the full reason | Date and doctor only |
| Assign to | Same doctor, changeable; Same doctor only | Same doctor, changeable |
| Never booked | Stays open as overdue; Expires automatically | Stays open as overdue |

---

## Auto-save behaviour

| Question | Options | Selected |
|----------|---------|----------|
| Timing | Shortly after typing stops; Every 30 seconds; Only on leaving a section | Shortly after typing stops |
| Save failure | Warn, keep text, keep retrying; Also keep a browser copy | Warn, keep text, keep retrying |
| Two PCs | Pause saving, keep text, offer reload; Lock to the first PC | Free text: "i will never allow to open same draft/login in tow pc at once" |
| Old drafts | Keep and list as unfinished; Doctor can discard with a reason | Keep and list as unfinished |

---

## One login at a time

Raised by the free-text answer above. Multiple concurrent sessions were the EG-10 default.

| Question | Options | Selected |
|----------|---------|----------|
| Second login, first ask | New login ends the old one; Block the new login | Ambiguous: the answer quoted wording from both options |
| Second login, clarified | Block, but allow takeover; Block only; New login ends the old one | Block, but allow takeover |
| Applies to | All accounts; Doctors only | All accounts |

---

## Printed summary

| Question | Options | Selected |
|----------|---------|----------|
| Audience | Patient copy; Full clinical record | Patient copy |
| With prescription | Separate documents; Summary includes medicines | Separate documents |
| Print when | After finalising only; Drafts too, marked DRAFT | After finalising only |
| Language | English with Hindi labels; English only | English with Hindi labels |

---

## Claude's Discretion

- Extra medicine fields (no preference given).
- Vitals entry and cross-doctor access details: offered as areas and not selected.
- Consultations with no appointment, and the exact schema.

## Deferred Ideas

- Printed glasses prescription from refraction findings.
