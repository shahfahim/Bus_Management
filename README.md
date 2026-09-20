<div align="center">
  <h1>🚌 UniRide</h1>
  <p><b>University Bus Management System</b></p>
  <p>
    <a href="#features">Features</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#documentation">Documentation</a>
  </p>
</div>

---

**UniRide** is a full-stack, real-time application built with TypeScript, React, Express, and PostgreSQL, designed specifically for university transport operations. It offers a comprehensive solution for managing fleets, scheduling trips, tracking buses, and handling student bookings.

## 📸 Screenshots

<p align="center">
  <img src="docs/assets/01-signin.png" width="800" alt="Sign In Page">
  <br><br>
  <img src="docs/assets/05-command-centre.png" width="800" alt="Command Centre Dashboard">
  <br><br>
  <img src="docs/assets/02-workspace.png" width="800" alt="Admin Workspace Overview">
  <br><br>
  <img src="docs/assets/03-trip-schedules.png" width="800" alt="Trip Schedules">
  <br><br>
  <img src="docs/assets/04-users.png" width="800" alt="User Management">
</p>

## ✨ Features

- **🎓 Student Portal:** Seat booking, digital bus passes, and QR code boarding.
- **🗺️ Live Tracking & GPS:** Real-time bus tracking and ETA updates via WebSockets.
- **📅 Automated Scheduling:** Set up recurring trips and let the background worker generate future schedules automatically.
- **🛡️ Admin Workspace:** RBAC-protected dashboard for managing users, trips, vehicles, incidents, and approvals.
- **🔔 Notifications:** Integrated Web Push notifications for trip delays, maintenance, and alerts.
- **🚦 Incident & Maintenance:** Comprehensive logging for road incidents, lost and found, and vehicle maintenance.

## 🏗️ Architecture

UniRide is a monorepo consisting of:
- **`apps/api`**: Node.js, Express 5, Socket.IO, Prisma ORM, PostgreSQL
- **`apps/web`**: React 19, Vite, Leaflet Maps, ZXing QR Scanner

*See the [Architecture Document](docs/ARCHITECTURE.md) for deeper design and systems notes.*

## 🚀 Getting Started

### Prerequisites
- Node.js 22+
- npm 10+
- PostgreSQL 15+ (or Docker)
- *Optional: Stripe CLI for payment testing*

### Quick Start
```bash
# 1. Clone the repository & copy environment variables
cp .env.example .env

# 2. Start PostgreSQL via Docker
docker compose up -d postgres

# 3. Install dependencies & initialize database
npm install
npm run db:generate
npm run db:migrate
npm run db:seed

# 4. Start the development server
npm run dev
```

> **API Health:** `http://localhost:4000/health/live`  
> **Web Client:** `http://localhost:5173`

### Default Accounts
The database seed creates these accounts (Passwords come from your `.env` `SEED_*_PASSWORD` variables, the default example is `ChangeMe123!`):

| Role | Email |
| :--- | :--- |
| **Admin** | `admin@example.edu` |
| **Driver** | `driver@example.edu` |
| **Student** | `student@example.edu` |

*(Note: In production, self-registered students require manual admin verification before login, and driver accounts can only be created by an Admin).*

## 🛠️ Quality Checks & Deployment

**Run Quality Checks:**
```bash
npm run verify # Runs lint, typecheck, test, and build in sequence
```

**Production Build:**
```bash
npm ci
npm run db:generate
npm run db:migrate
npm run build
```

*For free cloud hosting, see our [Supabase + Render Deployment Guide](docs/DEPLOY_FREE.md).*

---
<div align="center">
  <sub>Built for the future of university transport.</sub>
</div>
