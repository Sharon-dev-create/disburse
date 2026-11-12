# Execution service development environment

## Current architecture

`execution-service` is a strict TypeScript library, not a standalone server or worker. Its
`src/index.ts` exports provider, state-machine, discovery, and repository interfaces. It has no
process entrypoint, concrete execution worker, or readiness endpoint. It includes PostgreSQL
configuration/pool, versioned migrations, and internal repository composition for security
records and durable jobs; creating that composition connects to the configured database.

Do not infer execution readiness from successful tests or a healthy database. There is currently no
runtime readiness implementation. Any future runtime must report execution as disabled until
repositories and services are initialized and separately authorized; this foundation does not
contain signing or transaction submission.

## Required tools

- Node.js `>=22.13.0`, as declared in `execution-service/package.json`.
- pnpm. The available global installation reported `12.18.0`; the package currently does not pin
  a `packageManager` version. The lockfile uses format `9.0`.
- A local PostgreSQL service for integration tests, using the dedicated `disburse_test` database
  and role. Production databases must never be used for tests.

On a machine with package installation access, install a supported Node.js 22 release and npm,
then install the observed pnpm version with:

```sh
npm install --global pnpm@12.18.0
node --version
npm --version
pnpm --version
```

From `execution-service/`, install exactly from the existing lockfile and run the package checks:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test -- --test-reporter=spec
pnpm run format:check
pnpm run test:postgres
```

Do not regenerate `pnpm-lock.yaml` to work around an installation failure.

## Local PostgreSQL setup

Use a local PostgreSQL 18 server only. Keep it bound to loopback; do not reuse a production or shared
database. Create separate local roles and databases for development and tests, with passwords
entered interactively:

```sh
sudo apt-get install postgresql-18 postgresql-client-18
sudo -u postgres createuser --pwprompt disburse_dev
sudo -u postgres createdb --owner=disburse_dev disburse_dev
sudo -u postgres createuser --pwprompt disburse_test
sudo -u postgres createdb --owner=disburse_test disburse_test
pg_isready --host 127.0.0.1 --port 5432
```

Use the `disburse_test` database only for integration tests. Keep credentials in local, untracked
environment settings; never add them to `.env.example` or source control. Configure
`DISBURSE_TEST_DATABASE_URL` to target the loopback `disburse_test` database as role
`disburse_test`. `pnpm test:postgres` verifies the connected database and role before applying the
additive migrations or writing test records. Development migrations are available only through
`pnpm run db:migrate:dev`; integration tests never target the development URL.

Stop the local service with `sudo systemctl stop postgresql` when it is not needed. Do not remove a
local data directory without first checking whether it contains user data.

## Current validation environment

The current workspace has Node.js and pnpm, and the PostgreSQL client is installed. The
`DISBURSE_TEST_DATABASE_URL` variable is not configured, so the real PostgreSQL integration suite
cannot run here. `pnpm check` still runs formatting, type checking, linting, and unit tests. Do not
count the PostgreSQL tests as passing until they run against the dedicated local test database.
