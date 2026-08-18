---
---

chore(ci): use `github.actor` as the ghcr.io login username

Every Dependabot PR failed `Build` and `Tests` with `Error: Username required`. Dependabot-triggered runs read
secrets from the Dependabot store, which holds `MIDNIGHTCI_PACKAGES_READ` but not `GH_USERNAME`, so
`docker/login-action` got a password with no username.

Rather than mirror the secret into the second store, drop the `MIDNIGHT_GH_USER` indirection: a username is not a
secret, and `docker/login-action` only checks that it is non-empty (`src/docker.ts`) — ghcr.io authenticates on the
token, never on the username. `${{ github.actor }}` is GitHub's documented form and needs no secret store at all.

Also removes `MIDNIGHT_GH_USER` from `turbo.json` `globalEnv` (nothing reads it, and a per-actor value there would
vary turbo's global cache hash per contributor) and from the `workflow_call` secrets of `e2e-tests.yml`. The
`GH_USERNAME` Actions secret is now unused and can be deleted.
