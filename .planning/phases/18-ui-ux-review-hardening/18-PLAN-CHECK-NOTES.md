# Phase 18 plan-check notes (iteration 3 of 3, final) - all items moved into plans

Every open warning and info item has been converted into an explicit task step or acceptance criterion (with a verify that can fail) in the named plan. Checklist, one line per item:

## Warnings
- [x] W-A moved into plan 04 Task 4 (H2-declined fallback: assert `<Modal open={false} print=...>` renders no `dialog.print-portal`) and plan 04 coordination block (cites the B-1 H2 fallback).
- [x] W-B moved into plan 07 Task 4 (absolute paths for both pytest files; `test_health_tracer.py` runs only when PostgreSQL answers on 5432; applies only on explicit `csp-blob`).
- [x] W-C moved into plan 07 Task 5 (`git -C D:\dr-sr check-ignore -v` for both paths, output must contain both, verify fails otherwise).
- [x] W-D moved into plan 07 Task 3 (replace ALL `URL.createObjectURL` sites in PhotoUploader.tsx, 3 today incl. `usePhoto`; verify fails if the grep count is not 0 on the canvas branch; `usePhoto` test).
- [x] W-E moved into plan 07 Task 5 step 3 (template keeps the active line `KALYAN_COOKIE_SECURE=false`; `start-server.bat` sets true only inside the certificate branch; new `test_deploy_scripts.py` assertions; verify checks the template line).
- [x] W-F done in 18-RESEARCH.md: `## Open Questions (RESOLVED)` with one disposition per question naming its plan and task.
- [x] W-G moved into `<execution_rules>` R-5 in plan 01 (file-count check for plans 01 and 05; split 05a/05b if context pressure).
- [x] W-H moved into plan 03 context and plan 03 Task 1 done criterion (H1 double-decline: per-file `dialog-shim` import, each test file must pass when run alone).

## Info
- [x] I-1 moved into plan 01 Task 0a action (every consent and decision question asked up front in one turn; later tasks only re-ask unanswered ones).
- [x] I-2 moved into plan 04 frontmatter (PendingDuesPage and pending-dues test marked conditional on B-1 H4/H5; `main.tsx` or `router.tsx` for ReceiptHost listed as conditional).
- [x] I-3 moved into plan 02 frontmatter (`vite.config.ts` only if H1 declined and allowed; `setup-dialog.ts` conditional; `patient-edit-modal.test.tsx` listed).
- [x] I-4 moved into plan 07 frontmatter (`main.py`, CSP test, `config.py` and deploy files marked conditional) and plan 08 frontmatter (`index.css` only if H3 consented, `print.css` only if H3 declined).
- [x] I-5 (stale wave text, Task numbering) already fixed in plans 07/08 in round 2.
- [x] I-6 (tsconfig `node` types) already in plans 01, 04, 06.
- [x] I-7 moved into plan 05 Task 3 step 2 ("any file the guard reports", including new files from plans 01-04).
- [x] I-8 (summary file names) already fixed in round 2 (plan 07 writes 18-07-SUMMARY.md, plan 08 writes 18-08-SUMMARY.md).

## User decisions applied in this round
- [x] (a) root font-size: plan 05 Tasks 0, 2, 3, 4 (R1 only after the user reviewed the printed index.css diff and said `go R1`; default defer-root; before/after screenshots and layout-regression check M-18-14).
- [x] (b) previews: canvas, backend untouched, plan 07 Tasks 1, 3, 4.
- [x] (c) printer NOT assumed: plan 04 Task 1 hard blocking, no default; `fixed-200` kept only as an UNAPPROVED provisional value (plan 02 Task 2 comment, removed after plan 04 Task 5); Task 5 mandatory, SKIPPED not accepted, verify fails while UNAPPROVED remains.
- [x] (d) HTTPS optional: plan 07 Tasks 2 and 5 (default upload-only; no CA install or certificate work unless option A is approved).
- [x] (e) H1-H5: plan 01 Task 0a prints the full `git diff` of the exact files; a consent is valid only with "diff reviewed"; default decline; verify checks the record.
- [x] Execution rules (wave gate, per-wave record in 18-VALIDATION.md, synthetic data only, risk-area regression tests): plan 01 `<execution_rules>`, referenced from every plan; regression tests placed in plan 01 Tasks 1-2, plan 02 Task 3, plan 04 Tasks 2-3, plan 06 Task 2, plan 08 Task 4.
- [x] Payment-reversal UI is not in Phase 18, tracked separately: plan 01 R-6, plan 04 Task 3.
