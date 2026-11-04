-- Kalyan Hospital Centralized LAN Management System (v3.0)
-- Database Bootstrap Script (CE-5)
--
-- INSTRUCTIONS FOR SYSTEM ADMINISTRATOR:
-- 1. This script is run ONCE by a human administrator as the postgres superuser.
-- 2. Execute via psql with ON_ERROR_STOP=1:
--      psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -f backend/db/bootstrap.sql
-- 3. This script NEVER contains passwords or password literals.
--    The \password interactive meta-commands below will prompt for secret passwords securely.
--    Store the chosen passwords in a secure password manager and copy into backend/.env.
-- 4. In accordance with least-privilege security:
--    - kalyan_owner owns all database schema objects and runs Alembic migrations.
--    - kalyan_app is the runtime DML role used by the FastAPI service.
--    - kalyan_app is NEVER granted CREATE privileges on schemas or databases.

\set ON_ERROR_STOP on

-- Create database roles with login capability (passwords prompted interactively)
CREATE ROLE kalyan_owner LOGIN;
CREATE ROLE kalyan_app LOGIN;

-- Prompt for passwords securely without echoing to console or writing to history
\echo 'Set password for schema owner role (kalyan_owner):'
\password kalyan_owner

\echo 'Set password for application runtime role (kalyan_app):'
\password kalyan_app

-- Create development and test databases owned by kalyan_owner
-- Using builtin C.UTF-8 locale provider for deterministic cross-platform collation
CREATE DATABASE kalyan_dev
    WITH OWNER kalyan_owner
    TEMPLATE template0
    ENCODING 'UTF8'
    LOCALE_PROVIDER builtin
    BUILTIN_LOCALE 'C.UTF-8';

CREATE DATABASE kalyan_test
    WITH OWNER kalyan_owner
    TEMPLATE template0
    ENCODING 'UTF8'
    LOCALE_PROVIDER builtin
    BUILTIN_LOCALE 'C.UTF-8';

-- Throwaway database for real pg_dump and DROP SCHEMA tests; its contents are destroyed by every run
CREATE DATABASE kalyan_restore_test
    WITH OWNER kalyan_owner
    TEMPLATE template0
    ENCODING 'UTF8'
    LOCALE_PROVIDER builtin
    BUILTIN_LOCALE 'C.UTF-8';

-- Standardize application timezone strictly to Indian Standard Time (Asia/Kolkata)
ALTER DATABASE kalyan_dev SET timezone TO 'Asia/Kolkata';
ALTER DATABASE kalyan_test SET timezone TO 'Asia/Kolkata';
ALTER DATABASE kalyan_restore_test SET timezone TO 'Asia/Kolkata';

-- Enforce access restrictions: revoke public access and grant connect only to kalyan_app
REVOKE ALL ON DATABASE kalyan_dev FROM PUBLIC;
REVOKE ALL ON DATABASE kalyan_test FROM PUBLIC;
REVOKE ALL ON DATABASE kalyan_restore_test FROM PUBLIC;

GRANT CONNECT ON DATABASE kalyan_dev TO kalyan_app;
GRANT CONNECT ON DATABASE kalyan_test TO kalyan_app;
GRANT CONNECT ON DATABASE kalyan_restore_test TO kalyan_app;

-- PRODUCTION NOTES (Phase 17):
-- In production, the hospital server runs this script targeting a single database named `kalyan`.
-- If the PostgreSQL distribution rejects LOCALE_PROVIDER builtin (e.g. on older libc/Windows builds),
-- fall back to: LOCALE_PROVIDER icu ICU_LOCALE 'und-u-ks-level2'.

