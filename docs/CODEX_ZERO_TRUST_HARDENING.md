# Codex Zero-Trust Hardening

This document tracks the production-facing changes on branch `codex-zero-trust-hardening`.

Use it as the operating note for:
- Docker / LAN-only deployment
- security-sensitive behavior changes
- rebasing or merging this branch after pulling new code from the upstream repository

## Scope

This branch hardens 9Router for a local-network deployment model with stricter admin controls:
- no authentication bypass based on `localhost`
- no hard-coded JWT fallback secret
- no default bootstrap password such as `123456`
- sensitive admin routes require a valid admin session
- LAN mode disables public exposure features and blocks selected outbound admin actions

The goal is not "public SaaS mode". The goal is a safer self-hosted instance for Docker and private LAN usage.

## Behavior Changes

### Authentication

- Admin access is now fail-closed.
- Requests from `localhost`, `127.0.0.1`, or `::1` are no longer treated as authenticated.
- If `JWT_SECRET` is missing, dashboard login and protected admin flows fail closed instead of using a built-in secret.
- `INITIAL_PASSWORD` is required for first login until a saved password hash exists in `db.json`.

### Docker / LAN Mode

When `LAN_MODE=true`:
- Cloudflare tunnel features are disabled.
- version checks are disabled
- selected admin actions that trigger outbound internet access are blocked
- the recommended persistent data path is `/app/data`

This mode is intended for internal networks where users access the service via:
- `http://<server-lan-ip>:20128/dashboard`
- `http://<server-lan-ip>:20128/v1`

Keep `BASE_URL=http://localhost:20128` unless you have a concrete reason for the server to call itself through its LAN IP.

## Required Environment

Minimum runtime configuration for Docker / LAN production:

```env
JWT_SECRET=replace-with-a-long-random-secret
INITIAL_PASSWORD=replace-with-a-strong-bootstrap-password
DATA_DIR=/app/data
PORT=20128
HOSTNAME=0.0.0.0
NODE_ENV=production
LAN_MODE=true
BASE_URL=http://localhost:20128
AUTH_COOKIE_SECURE=false
```

Notes:
- set `AUTH_COOKIE_SECURE=true` only when the app is behind HTTPS
- `INITIAL_PASSWORD` is only used before a real dashboard password hash is saved
- if a password has already been configured in `${DATA_DIR}/db.json`, changing `INITIAL_PASSWORD` will not reset it

## Recommended Docker Compose Workflow

The branch includes [`docker-compose.yml`](/Users/lfun/00.Dev/03.opensource/9router/docker-compose.yml) and a LAN-oriented [`.env.example`](/Users/lfun/00.Dev/03.opensource/9router/.env.example).

Basic flow:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Persistent state lives in the named volume mounted at `/app/data`.

## Verification Checklist

After a fresh deploy or after rebasing onto upstream:

1. Confirm runtime env:
   ```bash
   docker exec 9router /bin/sh -lc 'env | grep -E "JWT_SECRET|INITIAL_PASSWORD|DATA_DIR|LAN_MODE|HOSTNAME|PORT"'
   ```
2. Confirm storage is writable:
   ```bash
   docker exec 9router /bin/sh -lc 'ls -la /app/data'
   ```
3. Confirm login route is no longer falling back to a default secret:
   ```bash
   docker logs --tail 200 9router
   ```
4. Confirm dashboard is reachable from another LAN device:
   ```text
   http://<server-lan-ip>:20128/dashboard
   ```
5. Confirm tunnel/version-check behavior matches `LAN_MODE=true`.

## Upstream Pull / Rebase Playbook

When you need new changes from the original repository:

```bash
git checkout codex-zero-trust-hardening
git fetch upstream
git rebase upstream/main
```

If the upstream default branch is not `main`, replace it with the correct branch name.

### Files Most Likely To Conflict

Review these carefully during conflict resolution:
- `src/dashboardGuard.js`
- `src/proxy.js`
- `src/app/api/auth/login/route.js`
- `src/app/api/settings/route.js`
- `src/app/api/version/route.js`
- `src/lib/runtimeConfig.js`
- `src/lib/serverAuth.js`
- `src/lib/serverNetworkPolicy.js`
- `src/lib/tunnel/cloudflared.js`
- `src/lib/tunnel/tunnelManager.js`
- `Dockerfile`
- `.env.example`
- `docker-compose.yml`

### Conflict Resolution Rules

Keep these branch invariants intact:
- never restore `localhost` as an authentication factor
- never restore a hard-coded JWT fallback secret
- never restore a built-in bootstrap password fallback
- keep sensitive admin routes protected by session checks
- keep `LAN_MODE=true` behavior fail-closed for tunnel, version checks, and outbound admin actions
- keep Docker data persisted under `/app/data`

### Fast Review After Rebase

Run these checks before deploying:

```bash
git diff --stat upstream/main...HEAD
rg -n "localhost|127\\.0\\.0\\.1|::1|123456|fallback|JWT_SECRET|LAN_MODE|INITIAL_PASSWORD" src README.md .env.example docs
```

Then rebuild and smoke test the container:

```bash
docker compose up -d --build
docker compose logs --tail 200
```

## Security Model Limits

This branch is safer for self-hosted LAN deployment, but it is not a full outbound-isolation sandbox.

Important limit:
- core routed provider traffic can still reach whatever upstream endpoint the operator configures

If you need strict egress control, add an allowlist at the provider request execution layer or enforce network policy outside the app with:
- Docker network policy
- host firewall rules
- an internal-only reverse proxy
- outbound DNS or IP allowlisting

## Commit Timeline

Hardening work currently lands in these commits:
- `3aa0523` Harden admin auth boundaries
- `b85fdeb` Harden bootstrap auth for Docker LAN mode
- `2a84310` Block outbound admin actions in LAN mode

Add future branch-specific operational notes to this document instead of scattering them across ad-hoc chat history.
