# UniRide Architecture & Project Structure

This document outlines the high-level architecture and directory structure of the **UniRide** Bus Management platform. For design invariants, security model and operational notes, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); for endpoints, see [docs/API.md](docs/API.md).

## 1. High-Level Architecture

UniRide is a web application built as a monorepo (npm workspaces). It separates the client-side presentation layer (`apps/web`) from the server-side business logic and data persistence layer (`apps/api`). In production the API can also serve the built web client from one process (`SERVE_WEB_ASSETS=true`).

### Technology Stack

**Frontend (`apps/web`)**
- **Core Framework**: React 19 with Vite.
- **Routing**: `react-router-dom` with lazy-loaded pages and role-guarded routes.
- **State & Data**: Context API for global state (Auth, Socket), custom hooks, and a small booking repository over a shared `fetch` client.
- **Real-time**: `socket.io-client` for live GPS, seat availability, trip status and notifications.
- **Mapping**: `leaflet` and `react-leaflet` with OpenStreetMap tiles.
- **Offline & PWA**: `vite-plugin-pwa` (injectManifest) with a Workbox service worker that caches assets and API responses and handles Web Push.
- **Utilities**: `jsbarcode` for Code 128 boarding cards, `recharts` for charts, `jspdf`/`papaparse` for exports, `framer-motion` for transitions.

**Backend (`apps/api`)**
- **Server**: Node.js 22 with Express 5.
- **Database ORM**: Prisma ORM over PostgreSQL.
- **Real-time Engine**: `socket.io` with JWT-authenticated user, role and trip rooms.
- **Security**: `helmet`, exact-origin `cors`, `express-rate-limit`, bcrypt passwords, short-lived JWT access tokens and rotating refresh sessions in HttpOnly cookies.
- **Validation**: `zod` request schemas.
- **Integrations**: `stripe` (Checkout + signed webhooks), `web-push` (VAPID), optional Supabase Storage for uploads.
- **Background work**: in-process monitors for seat-hold expiry, maintenance reconciliation, GPS health, notification retries, and a trip generator that creates the next 7 days of trips from recurring schedules.

---

## 2. File & Directory Architecture

```text
Bus_Management/
├── apps/
│   ├── api/                          # 🚀 Backend Express application (@bus/api)
│   │   ├── prisma/
│   │   │   ├── migrations/           # SQL migration history
│   │   │   ├── schema.prisma         # All database models, enums and indexes
│   │   │   └── seed.ts               # Seed accounts, fleet, routes and trips
│   │   ├── uploads/                  # Local upload directory (dev / single instance)
│   │   └── src/
│   │       ├── config/env.ts         # Zod-validated environment variables
│   │       ├── lib/                  # Shared server utilities
│   │       │   ├── campus-time.ts        # Campus (Dhaka) day boundaries
│   │       │   ├── booking-lock.ts       # Row locks shared by booking workflows
│   │       │   ├── bus-schedule-lock.ts  # Advisory locks for bus scheduling/maintenance
│   │       │   ├── errors.ts             # AppError, 404 and error handlers
│   │       │   ├── geo.ts                # Distance, progress and ETA helpers
│   │       │   ├── logger.ts             # Pino logger
│   │       │   ├── maintenance-window.ts # Maintenance overlap checks
│   │       │   ├── object-storage.ts     # Local disk / Supabase Storage uploads
│   │       │   ├── prisma.ts             # Prisma client singleton
│   │       │   ├── reserved-seats.ts     # Front seats reserved for teachers
│   │       │   ├── security.ts           # SHA-256, random tokens, email normalization
│   │       │   ├── web-assets.ts         # Serves the built web client in production
│   │       │   └── ...                   # pagination, password policy, rate limits, request context
│   │       ├── modules/              # Feature modules: *.routes.ts, *.schemas.ts, *.service.ts
│   │       │   ├── admin/            # Fleet, routes, trips, schedules, people, finance, incidents, audit, analytics
│   │       │   ├── auth/             # Registration, login, refresh, logout, JWT middleware, avatars
│   │       │   ├── bookings/         # Seat holds, bookings, cancellation, hold-expiry monitor
│   │       │   ├── catalog/          # Public buses, routes, stops, trips and seat availability
│   │       │   ├── lost-found/       # Reports, image uploads, matching and claims
│   │       │   ├── maintenance/      # Maintenance records and reconciliation monitor
│   │       │   ├── notifications/    # In-app + Web Push delivery strategies and retry monitor
│   │       │   ├── payments/         # Stripe Checkout, webhooks, receipts, refunds
│   │       │   ├── boarding/         # Boarding cards, door readers and barcode check-in
│   │       │   ├── ratings/          # Driver ratings
│   │       │   ├── road-alerts/      # Road alerts and affected-rider notifications
│   │       │   ├── subscriptions/    # Travel-pass plans and student subscriptions
│   │       │   ├── tracking/         # Driver trips, GPS ingestion, incidents, custom trips, GPS monitor
│   │       │   ├── trips/            # Trip generator worker for recurring schedules
│   │       │   └── users/            # Profile and role dashboards
│   │       ├── realtime/hub.ts       # Socket.IO server, auth and room/emit helpers
│   │       ├── types/express.d.ts    # Request augmentation (auth context)
│   │       ├── app.ts                # Middleware stack and route mounting (/api and /api/v1)
│   │       └── server.ts             # Entry point: HTTP + Socket.IO + monitors, graceful shutdown
│   │
│   └── web/                          # 💻 Frontend React application (@bus/web)
│       ├── public/
│       │   ├── favicon.svg           # App icon
│       │   └── manifest.webmanifest  # PWA manifest
│       └── src/
│           ├── components/           # AppShell, LiveMap, SeatMap, BookingPass, TripLocationPicker,
│           │   │                     # ProtectedRoute, ErrorBoundary, ui.tsx (shared UI kit)
│           │   ├── animations/       # withAnimation transition wrapper
│           │   └── charts/           # ChartFactory (Recharts)
│           ├── contexts/             # AuthContext, SocketContext (reconnects and restores trip rooms)
│           ├── hooks/                # useLocationSharing (driver GPS), useRemoteData
│           ├── lib/                  # api.ts (fetch client + session refresh), format.ts,
│           │                         # offline-cache.ts, ExportFacade.ts (CSV/PDF)
│           ├── pages/
│           │   ├── admin/            # AdminWorkspacePage (/admin/:section), AdminSchedulesPage
│           │   ├── driver/           # Trips, trip detail (manual check-in), create trip, incidents
│           │   ├── student/          # Boarding card, live buses, routes, booking, bookings, payments, expenses,
│           │   │                     # subscriptions, ratings
│           │   ├── shared/           # Notifications, lost & found
│           │   └── AuthPage.tsx ...  # Auth, dashboard, profile, change password, 404
│           ├── services/             # Booking repository over the API client
│           ├── styles/               # base, layout, components, modules, pages, responsive CSS
│           ├── types/index.ts        # Frontend types mirroring API responses
│           ├── App.tsx               # Routes and role guards
│           ├── main.tsx              # Bootstrap, providers, service worker registration
│           └── sw.ts                 # Workbox service worker: caching + Web Push handlers
│
├── docs/                             # 📚 API, architecture, deployment and security audit
├── nginx/default.conf                # Reverse proxy for the Docker production setup
├── Dockerfile.api / Dockerfile.web   # Container images
├── docker-compose.yml                # Local PostgreSQL
├── docker-compose.prod.yml           # Production containers (Postgres, migrate, API, web/nginx)
├── render.yaml                       # Render free-tier blueprint (single service)
├── .env.example                      # Template for required environment variables
├── package.json                      # Workspaces and root scripts
└── README.md                         # Project landing page and Getting Started guide
```

---
*Generated for the UniRide Development Team.*
