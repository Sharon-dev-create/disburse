# Execution service PostgreSQL integration

The execution service uses PostgreSQL for durable execution authorizations and
immutable per-payout refund policies. The `pg` pool is adapted to the existing
repository interfaces in `execution-service/src/persistence`; the service does
not fall back to in-memory repositories. In-memory implementations remain for
unit tests only.

## Configuration and safety

Use separate local databases and roles:

| Target | Required variable | Required database and role |
| --- | --- | --- |
| Development | `DISBURSE_DEV_DATABASE_URL` | `disburse_dev` / `disburse_dev` |
| Integration test | `DISBURSE_TEST_DATABASE_URL` | `disburse_test` / `disburse_test` |
| Production composition | `DISBURSE_DATABASE_URL` | Explicit production URL |

Development and test URLs are validated against the expected database, role,
and loopback host. The integration suite reads only
`DISBURSE_TEST_DATABASE_URL`, checks its connected database and role, and fails
if the URL is absent or invalid. `pnpm test` covers deterministic unit tests;
`pnpm test:postgres` is an explicit real-database suite and never substitutes a
mock. The latter does not apply migrations. Run the migration command first.

The versioned migration runner serializes concurrent invocations with a
transaction advisory lock and records a SHA-256 checksum for each migration.
It runs each migration and its history insert in the same transaction. It
refuses unknown versions, checksum changes, incompatible migration history,
and unversioned pre-existing security objects. Migration SQL is additive; it
does not drop or reset existing application data. If it refuses pre-existing
objects, stop and inspect the schema before deciding how to baseline it.

The runtime role needs only the DML rights required by the repositories and
must not own the tables or have permission to disable triggers. Use a separate
migration owner in a production deployment. The database triggers protect
payload immutability and legal lifecycle transitions for ordinary DML; a
database owner/superuser can alter or disable them. These controls do not
protect against a fully compromised database administrator.

## Host-side setup and verification

Run these commands from a normal Ubuntu terminal with access to the local
PostgreSQL server. Keep actual URLs in a private, untracked file; do not paste
them into chat or commit them. The example file contains placeholders only.

```bash
cd ~/disburse/execution-service
cp .env.example .env.integration.local
chmod 600 .env.integration.local
${EDITOR:-nano} .env.integration.local
```

Set both URL variables in that file to their respective loopback databases.
The development URL should use database and role `disburse_dev`; the test URL
should use `disburse_test`. Then load them into the current shell without
printing them:

```bash
set -a
. ./.env.integration.local
set +a
```

Install the locked package dependencies if needed, then run the separate
development and test migration commands. These are the commands that apply
the additive schema; inspect their output and stop if the migration runner
reports an unversioned object or incompatibility.

```bash
pnpm install --frozen-lockfile
pnpm run db:migrate:dev
pnpm run db:migrate:test
```

Run the checks and the real integration suite explicitly:

```bash
pnpm run format:check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run test:postgres
```

`test:postgres` performs real writes only in `disburse_test`. It uses unique
per-run records and deliberately does not delete them because the schema
enforces immutability. Keep this database dedicated to integration testing;
discard/recreate it only through a separately reviewed operator procedure.
The suite checks persistence across fresh Node processes, independent pool
connections, one-winner authorization races, immutable refund binding,
parameterized lookups, and transaction rollback. These checks are not reported
as passing until their output is observed from the host PostgreSQL environment.

## Scope and limitations

This package currently provides repository adapters and a composition root for
the security repositories; it does not start a worker or submit transactions.
PostgreSQL durability does not verify external chain execution. Authorization
and refund-policy correctness still depend on the surrounding signer,
provider, and verifier controls.
