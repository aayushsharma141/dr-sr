# Phase 18 manual checks

Synthetic data only (names like "Test Patient One", URN `TEST-0001`, mobiles 9000000xxx). Record PASS or FAIL with notes for each item. Do not count a SKIPPED item.

## Receipts and printers (plan 04 Task 5, blocking before 18-04-SUMMARY.md)

Printer: not provided and not tested (client waiver, 2026-11-03)
Paper: A4 sheet (approved 2026-11-02)

- M-18-01 A4 receipt: record a payment from Pending Dues, press Print in the receipt dialog, print on the real printer. Check: one A4 page, margins, nothing cut, clinic header from Settings, Devanagari glyphs render.
  Result: WAIVED BY CLIENT — NOT TESTED (not a pass). Printer compatibility unverified; see 18-DECISIONS.md "Plan 04 Task 5".
- M-18-02 DUPLICATE legibility: Reprint from the patient's Payments and receipts card. Check: "(DUPLICATE COPY)" and the bordered DUPLICATE stamp are clearly legible on paper.
  Result: WAIVED BY CLIENT — NOT TESTED (not a pass). Printer compatibility unverified; see 18-DECISIONS.md "Plan 04 Task 5".
- M-18-03 A4 registration card: print the card. Check: one A4 page, approved SAMPLE letterhead, dual signature block.
  Result: WAIVED BY CLIENT — NOT TESTED (not a pass). Printer compatibility unverified; see 18-DECISIONS.md "Plan 04 Task 5".
- M-18-04 A4 prescription slip: print the slip for a short prescription. Check: one A4 page, letterhead matches SAMPLE.pdf.
  Result: WAIVED BY CLIENT — NOT TESTED (not a pass). Printer compatibility unverified; see 18-DECISIONS.md "Plan 04 Task 5".

## Outstanding manual checks: NOT RUN (recorded 2026-11-03)

These need a person with a real browser, display or screen reader. Automated tests (jsdom, headless Edge page size) do NOT cover them. Every result below is NOT RUN; none of these may be reported as passed. Plan 08 (not started) is meant to consolidate them.

- M-18-06 Display scaling (plan 05 Task 4): at Windows scaling 100, 125 and 150 percent open AppShell, a dialog (payment, patient edit), a table (patients, pending dues) and the registration form; look for clipped or overlapping small text.
  Result: NOT RUN
- M-18-15 Dialog keyboard behaviour in real Edge (plans 02 and 03): Tab and Shift+Tab stay inside an open dialog, Esc closes it (except destructive confirmations and the temporary-password dialog), and focus returns to the control that opened it. Check payment, payment reversal, patient edit, backup restore and the session dialogs. jsdom only checks Esc and focus return.
  Result: NOT RUN
- M-18-16 Dialog first-field focus (KNOWN ISSUE): the session logger and session addendum dialogs open with focus on the Close button, not the first field. Needs a fix and then this check.
  Result: NOT RUN (known failing)
- M-18-08 Screen reader (plan 08): with NVDA, confirm dialog titles are announced on open, banners and error messages (InlineAlert, payment and backup errors) are announced, and the receipt and payment history are readable.
  Result: NOT RUN
- M-18-17 Long Hindi and English text in dialogs: open a dialog with very long English and Hindi content and check it scrolls inside the dialog without clipping. The tests only check the scrolling classes.
  Result: NOT RUN
- M-18-18 Hindi glyphs on printed output: printed Devanagari rendering on the registration card, prescription slip and receipt. Needs a printer (the printer test was waived) and the bundled font from plan 06, which is not implemented.
  Result: NOT RUN (waived with the printer checks above, plus plan 06 not started)

## Later sections (added by plan 08)
