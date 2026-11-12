# Execution service PostgreSQL integration

The execution service uses PostgreSQL for durable execution authorizations,
immutable per-payout refund policies, and operational execution jobs. The `pg`
pool is adapted to repository interfaces in `execution-service/src/persistence`.
In-memory implementations remain test-only.

## Configuration and safety

Use separate local databases and roles:

| Target                 | Required variable            | Required database and role        |
| ---------------------- | ---------------------------- | --------------------------------- |
| Development            | `DISBURSE_DEV_DATABASE_URL`  | `disburse_dev` / `disburse_dev`   |
| Integration test       | `DISBURSE_TEST_DATABASE_URL` | `disburse_test` / `disburse_test` |
| Production composition | `DISBURSE_DATABASE_URL`      | Explicit production URL           |

Development and test URLs are validated against the expected database, role,
and loopback host. The integration suite reads only
`DISBURSE_TEST_DATABASE_URL`, checks its connected database and role, and fails
if the URL is absent or invalid. `pnpm test` covers deterministic unit tests;
`pnpm test:postgres` is an explicit real-database suite and never substitutes a
mock. Before applying migrations, the suite confirms that the connected database
and role are exactly `disburse_test`. It then applies only additive versioned
migrations and checks their history.

The versioned migration runner serializes concurrent invocations with a
transaction advisory lock and records a SHA-256 checksum for each migration.
It runs each migration and its history insert in the same transaction. It
refuses unknown versions, checksum changes, incompatible migration history,
and unversioned pre-existing security or job objects. Migration SQL is additive; it
does not drop or reset existing application data. If it refuses pre-existing
objects, stop and inspect the schema before deciding how to baseline it.

The runtime role needs only the DML rights required by the repositories and
must not own the tables or have permission to disable triggers. Use a separate
migration owner in a production deployment. Migration `0001` protects security
repository invariants; migration `0002` prevents ordinary DML from changing a
job's identity or canonical payout snapshot. Job lifecycle transitions are
checked by the shared TypeScript state machine and conditional versioned SQL
writes. A database owner/superuser can alter or disable triggers.

## Migrated job tables and trust boundary

Migration `0002_execution_jobs` creates only `execution_jobs`,
`execution_attempts`, and `job_leases`, plus their indexes and an immutable
snapshot trigger. The provider-reference, verification, settlement, processing
error, and reconciliation tables in `sql/schema.sql` remain reference-only.
The reference schema is not itself executed by package scripts.

Jobs are keyed by `network_id + contract_id + payout_id`. Job-creation
idempotency is separately unique by `(network_id, contract_id,
job_creation_idempotency_key)`; it is not a provider idempotency key. A repeat
with the same key and identical protected payload returns the existing job;
reusing that key with changed payout/event data conflicts. A duplicate payout
identity with the same canonical snapshot also returns the existing job, even
if it arrived under a different job-creation key. A differing snapshot
conflicts. The canonical snapshot digest and protected payload hash are stored
separately. Amounts use exact decimal values, and PostgreSQL BIGINT identifiers
are mapped as decimal strings.

The payout identity is external to this service; there is deliberately no
foreign key to an invented local payout ledger. Creation accepts only a
validated observation whose status is `Reserved`. A discovered-event row is
not proof of current contract state. Any future authorization or execution
must independently reread the contract and revalidate the payout. Database job
state is never proof of reservation, delivery, settlement, or reservation
release.

Claims use a transaction, deterministic eligibility ordering, and
`FOR UPDATE SKIP LOCKED`. Each claim increments a durable per-job numeric
fencing counter and state version before replacing the current lease. Every
lease-protected write checks the owner, fencing token, expected job version,
and persisted expiry against database statement time. Renewals cannot trust a
worker-supplied expiry. Attempt insertion and attempt-count/version updates are
one transaction.

Expired `Leased` work may be returned to `Queued` and claimed again. An expired
lease in any state that may have crossed an external boundary is moved to
`ManualReview` when permitted by the centralized state machine. Already
`ManualReview` work stays there; `Completed` and `Abandoned` remain terminal.
Recovery removes only the expired operational lease. It never asserts provider
failure, destination delivery, contract settlement, or releases a contract
reservation.

This milestone adds no worker, public mutation endpoint, provider execution,
signing, refund execution, destination verification, or settlement submission.

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
The suite checks migration application, independent-connection idempotency and
claim races, lease renewal/expiry/fencing, attempts, safe failure recording,
recovery, restart persistence, and existing authorization/refund behavior.
These checks are not reported as passing until their output is observed from
the host PostgreSQL environment.

## Scope and limitations

The package provides repository adapters and internal composition; it does not
start a worker or submit transactions. PostgreSQL durability does not verify
external chain execution. Authorization and refund-policy correctness still
depend on the surrounding signer, provider, and verifier controls.
