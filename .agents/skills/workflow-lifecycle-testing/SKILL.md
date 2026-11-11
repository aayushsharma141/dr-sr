---
name: workflow-lifecycle-testing
description: Executes and verifies complete Kalyan Hospital business workflows across frontend, backend, database and dependent modules.
---
# Workflow Lifecycle Testing

## Objective
Verify complete business processes, not isolated screens or endpoints.

## Required method
For every workflow:
1. Identify the starting actor.
2. Establish preconditions.
3. Prepare synthetic test data.
4. Execute the actual UI operation where available.
5. Verify the API request and response.
6. Verify persisted database state.
7. Verify dependent records.
8. Verify connected module updates.
9. Reload the browser and verify persistence.
10. Execute failure and edge-case scenarios.
11. Record reproducible evidence.

## Required verification layers
- Frontend.
- Backend.
- Database.
- Integration.
- Permissions.
- Regression.

## Financial verification
Check invoice items, payment transactions, receipts and outstanding balances independently. Never overwrite transaction history.

## Treatment verification
Check that a treatment package is deducted only after successful session completion.

## Queue verification
Check doctor ownership, token uniqueness, status transitions and concurrent updates.

## Evidence
Record:
- Workflow ID.
- Test data identifiers.
- Steps executed.
- API results.
- Database assertions.
- Screenshots where available.
- Test command and exit code.
- Failures.
- Final PASS / FAIL / BLOCKED status.

Never claim verification when a required layer was not tested.

