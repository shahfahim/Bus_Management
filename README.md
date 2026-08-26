# UniRide — University Bus Management System

UniRide is a TypeScript full-stack application for university transport operations. It covers student seat booking, route-scoped bus passes and payments, driver trip controls and GPS tracking, single-use QR boarding, push/in-app notifications, maintenance and road alerts, lost and found, incident triage, ratings, and an RBAC-protected administration workspace.

## Repository layout

```text
apps/
  api/                 Express 5, Socket.IO, Prisma, PostgreSQL
    prisma/            Schema, SQL migration, deterministic demo seed
    src/modules/       Domain modules and REST routers
    src/realtime/      Authenticated Socket.IO rooms/events
  web/                 React 19, Vite, Leaflet, ZXing
docs/
  API.md               API and real-time interface summary
  ARCHITECTURE.md      Design, invariants, and operations notes
  DEPLOY_FREE.md       Supabase + Render showcase deployment
```

The API is available under both `/api` and the versioned `/api/v1` prefix. The web development server proxies API and Socket.IO traffic to port `4000`.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- PostgreSQL 15 or newer, or Docker with Compose
- A Stripe account and Stripe CLI for real payment testing (optional for all non-payment flows)

## Run locally

PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Bash:

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:5173`. The API health endpoints are `http://localhost:4000/health/live` and `http://localhost:4000/health/ready`.

The seed creates these development accounts. Their passwords come from the matching `SEED_*_PASSWORD` variables in `.env`; the example value is `ChangeMe123!`.

| Role | Email |
| --- | --- |
| Administrator | `admin@example.edu` |
| Driver | `driver@example.edu` |
| Student | `student@example.edu` |

Change all seed passwords and application secrets outside local development. The seed refuses to promote or reactivate an existing account and rejects shared/default seed passwords in production.

## Configuration

Copy `.env.example` to `.env`. The API validates configuration at startup and refuses known example secrets in production.

Local development intentionally relies on the API's default `NODE_ENV=development`; do not add `NODE_ENV=development` to the shared root `.env`, because Vite also reads that file during web builds. Production sets `NODE_ENV=production` through `.env.production`.

Required settings:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `QR_SIGNING_SECRET` (at least 32 characters)
- `WEB_ORIGIN` and `PUBLIC_API_URL`
- Self-registration accepts any syntactically valid email for students, teachers, and drivers; every new account remains pending until an administrator verifies it.

Self-registered students are created as `PENDING_VERIFICATION`. An administrator must verify the university identity and activate the account in the Users workspace before the student can sign in.

Optional integrations:

- Stripe: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, then forward verified events during development:

  ```powershell
  stripe listen --forward-to localhost:4000/api/webhooks/stripe
  ```

- Web Push: generate a VAPID pair and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`:

  ```powershell
  npm exec -w @bus/api -- web-push generate-vapid-keys
  ```

- Supabase Storage: set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET` for private, durable incident and lost-and-found images. The legacy `SUPABASE_SERVICE_ROLE_KEY` variable remains supported. `UPLOAD_MAX_MB` is capped at 10 MB.
- `UPLOAD_DIR` is the local-development fallback when Supabase Storage is not configured.

## Quality commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
# all four gates in sequence
npm run verify
```

Database commands:

```powershell
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:studio -w @bus/api
```

## Production build

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run build
$env:NODE_ENV='production'
npm run start -w @bus/api
```

Set `SERVE_WEB_ASSETS=true` to have the API serve `apps/web/dist` as a same-origin deployment, or serve it from a separate static web server and reverse-proxy `/api`, `/api/v1`, and `/socket.io`. Use TLS, a managed PostgreSQL database, durable upload storage, rotated secrets, and the real public origins in production.

For the zero-budget showcase deployment, follow [the Supabase + Render guide](docs/DEPLOY_FREE.md). The repository-level `render.yaml` builds the React client, runs Prisma migrations, starts the API, and serves everything from one free Render web service.

### Container deployment

The production Compose stack includes PostgreSQL, a one-shot migration job, the non-root API container, and an Nginx web/reverse-proxy container with SPA routing, WebSocket support, health checks, cache policy, and security headers.

```powershell
Copy-Item .env.production.example .env.production
# Replace every CHANGE_THIS value and set the public HTTPS origin first.
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Open the configured HTTPS origin through your TLS/load-balancer endpoint. Port `8080` is exposed for the upstream proxy by default. `DATABASE_URL` must use the Compose hostname `postgres`; URL-encode special characters in database credentials.

To stop the application without deleting database or upload data:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

Run the complete release gate before deployment:

```powershell
npm ci
npm run db:generate
npm run verify:release
```

The API refuses startup when PostgreSQL is unavailable, production origins are not HTTPS, signing secrets are shared/default-like, Stripe or VAPID credential pairs are incomplete, or production seed passwords are shared/default-like.

See [the architecture guide](docs/ARCHITECTURE.md) and [API summary](docs/API.md) for implementation details.
