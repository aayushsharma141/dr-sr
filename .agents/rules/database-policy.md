# Kalyan Hospital — Database & Migration Safety Policy

## Database Environment Invariants
1. **Isolated Environments**:
   - Production database: `kalyan`
   - Development database: `kalyan_dev`
   - Test database: `kalyan_test` (Enforced safety check in conftest: DB name must end with `_test`)
2. **PostgreSQL Roles**:
   - `kalyan_app`: Runtime application user (DML only: SELECT, INSERT, UPDATE, DELETE). Has NO DDL or DROP permissions.
   - `kalyan_owner`: Schema owner strictly for running Alembic migrations.
3. **Audit Log Immutability**:
   - The `audit_logs` table is strictly append-only.
   - DDL triggers prevent UPDATE, DELETE, or TRUNCATE on audit tables.
4. **Migration Rules**:
   - All schema changes must be versioned via Alembic migrations in `backend/src/kalyan_api/migrations/versions/`.
   - Never edit existing applied migration files in production; create new forward migrations.
   - Verify down-revisions and foreign-key dependencies.
   - Any schema migration requires explicit human approval before running against non-test databases.
5. **Data Protection**:
   - Never drop tables or delete production patient/clinical/financial data.
   - Never overwrite payment history or patient identities.

