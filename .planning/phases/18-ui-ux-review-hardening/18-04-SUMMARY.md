# 18-04 summary: receipts and print check — CLOSED WITH WAIVER

Requirements: UX-01 (receipts print from the app), UX-08 (print part).

Status: closed 2026-11-03. Task 5 (real printer check) was WAIVED BY CLIENT and is NOT TESTED. It is not recorded as a pass. Physical printer compatibility is UNVERIFIED and is outside current acceptance.

Done (automated, verified):
- Paper: A4 (client decision 2026-11-02). Requirement change from 80 mm recorded separately in 18-DECISIONS.md. Historical Phase 17 text NOT modified.
- ReceiptPrint takes clinic settings for the header, address and phone; standard fallback text; the placeholder phone number is removed; no theme-dependent classes; Hindi marked `lang="hi"`.
- ReceiptDialog: named A4 receipt page, Print button focused, DUPLICATE COPY title and a solid bordered stamp on reprint.
- Payment flow: PaymentModal announces each saved payment (`kalyan:payment-recorded`); ReceiptHost, mounted once in main.tsx, opens the receipt. PendingDuesPage and its test are UNCHANGED (B-1 H4/H5 declined; other agent's files).
- PaymentHistory card on the patient page (Admin and Reception only): receipts, Reprint with DUPLICATE COPY; reversed payments labelled and not reprintable. The reversal screen is NOT mounted (out of Phase 18; BIL-05 UI gap).
- Print check (six Edge headless tests, mandatory, 6 of 6 passing 2026-11-03): registration card 1 A4 page; prescription slip 1 A4 page; receipt 1 A4 page; a 120-line dialog paginates to 2+ pages; a closed print dialog mounts nothing; the card prints one page with a closed print dialog present.
- Not created: `useReceiptPageHeight` (content-fit applies to roll paper only; not needed for A4).

Not verified:
- Physical printer output (waived by client): paper handling, margins on a real device, cut, DUPLICATE legibility on paper. Recorded as limitation.
- Hindi glyph rendering on printed output: not covered by a check here; plan 06 adds the bundled font and its checks.

Gates: see 18-VALIDATION.md, Wave 3. Not committed.
