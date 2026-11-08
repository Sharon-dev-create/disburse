# Execution service development environment

## Current architecture

`execution-service` is a strict TypeScript library, not a standalone server or worker. Its
`src/index.ts` exports provider, state-machine, discovery, and repository interfaces. It has no
process entrypoint, application composition root, concrete execution worker, database connection,
or readiness endpoint. The PostgreSQL security repositories accept an injected query function;
that is an adapter boundary, not a configured PostgreSQL connection.

Do not infer execution readiness from successful tests or a healthy database. There is currently no
runtime readiness implementation. Any future runtime must report execution as disabled until
repositories and services are initialized and separately authorized; this foundation does not
contain signing or transaction submission.

## Required tools

- Node.js `>=22.13.0`, as declared in `execution-service/package.json`.
- pnpm. The available global installation reported `12.18.0`; the package currently does not pin
  a `packageManager` version. The lockfile uses format `9.0`.
- PostgreSQL 18 for the planned local integration environment. PostgreSQL is not yet connected to
  the package, and no schema or migration should be applied as part of environment setup.

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

Use the `disburse_test` database only for disposable integration tests. Keep credentials in local,
untracked environment settings; never add them to `.env.example` or source control. This milestone
does not define a connection variable, run migrations, or connect a repository. Before the next
database milestone, verify the local server and both database roles independently with `psql`.

Stop the local service with `sudo systemctl stop postgresql` when it is not needed. Do not remove a
local data directory without first checking whether it contains user data.

## Environment status for Milestone 13.2.1A

This workspace could not establish the tools above:

- `node` and `npm` resolve to Snap launchers that fail with a Snap confinement/AppArmor error.
- Global `pnpm --version` reports `12.18.0`, but frozen installation fails because pnpm cannot open
  its store operation lock in the read-only environment. Setting a store directory did not resolve
  that error.
- Ubuntu's package metadata offers Node.js `22.22.1` and PostgreSQL `18`, but system installation
  is unavailable: the workspace runs without root privileges (`no new privileges`). Package
  downloads also fail because `archive.ubuntu.com` and `security.ubuntu.com` do not resolve.
- No PostgreSQL server/client packages are installed. Docker's Snap launcher cannot create its
  runtime directory, so there is no usable Docker daemon.
- The repository contains no CI workflow, Docker Compose file, or existing local database setup to
  extend. No database dependency was added and no speculative service scaffolding was introduced.

The smallest unblock is to provide a Node.js 22.13+ and npm installation that runs outside Snap,
permit pnpm to write its package store, and provide either a local PostgreSQL 18 service or a
working local Docker daemon. Then run the tool checks above and verify `pg_isready` plus connections
to the isolated databases. Only after that should the PostgreSQL driver and runtime composition be
added and verified in the follow-up milestone.
