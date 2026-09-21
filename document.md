# UniRide Architecture & Project Structure

This document outlines the high-level architecture and detailed directory structure of the **UniRide** Bus Management platform.

## 1. High-Level Architecture

UniRide is a modern web application built using a monorepo structure (managed via npm workspaces). It strictly separates concerns between the client-side presentation layer (Web) and the server-side business logic and data persistence layer (API).

### Technology Stack

**Frontend (`apps/web`)**
- **Core Framework**: React 19 with Vite for lightning-fast bundling.
- **Routing**: `react-router-dom` for client-side routing.
- **State & Data**: Context API for global state (Auth, Theme, Socket) and custom hooks.
- **Real-time**: `socket.io-client` for real-time GPS tracking and live updates.
- **Mapping**: `leaflet` and `react-leaflet` for rendering interactive live bus maps.
- **Offline & PWA**: `vite-plugin-pwa` and Google Workbox for service workers, caching, and offline capabilities.
- **Utilities**: `zxing/browser` for QR Code scanning and `recharts` for data visualization.

**Backend (`apps/api`)**
- **Server**: Node.js with Express 5.
- **Database ORM**: Prisma ORM interacting with a PostgreSQL database.
- **Real-time Engine**: `socket.io` for bi-directional communication (emitting GPS coordinates to riders).
- **Security**: `helmet`, `cors`, `express-rate-limit`, and custom JWT-based authentication.
- **Validation**: `zod` for robust, type-safe request payload validation.
- **Notifications & Payments**: Integrated `web-push` for browser notifications and `stripe` for payment processing.

---

## 2. File & Directory Architecture

The repository is structured as a monorepo. Below is a comprehensive tree detailing the purpose of each directory and critical file.

```text
e:\Bus_Management\
├── apps/
│   ├── api/                     # 🚀 Backend Node.js Express Application
│   │   ├── prisma/              # Database Schema and Migrations
│   │   │   ├── migrations/      # Auto-generated SQL migration history
│   │   │   ├── schema.prisma    # Prisma schema defining all database models
│   │   │   └── seed.ts          # Database seed script for initial testing data
│   │   └── src/                 
│   │       ├── config/          # Configuration files (environment variables, constants)
│   │       ├── lib/             # Core utilities and shared libraries
│   │       │   ├── auth.ts      # JWT signing and verification utilities
│   │       │   ├── logger.ts    # Pino-based application logging
│   │       │   └── prisma.ts    # Singleton Prisma Client instance
│   │       ├── modules/         # Domain-Driven Design (DDD) Feature Modules
│   │       │   ├── auth/        # Authentication, login, and registration routes
│   │       │   ├── incidents/   # Incident reporting and management logic
│   │       │   ├── trips/       # Trip scheduling, assignment, and status updates
│   │       │   └── users/       # User management, role updates, and approvals
│   │       ├── realtime/        # WebSockets / Real-time Logic
│   │       │   ├── socket.ts    # Socket.IO server initialization
│   │       │   └── tracking.ts  # Handlers for driver GPS ping and student subscription
│   │       ├── types/           # Global TypeScript type definitions for the API
│   │       ├── app.ts           # Express application setup, middleware, and route mounting
│   │       └── server.ts        # Entry point: starts the Express server and Socket.IO
│   │
│   └── web/                     # 💻 Frontend React Application
│       ├── public/              # Static Assets
│       │   ├── icons/           # PWA icons (Android, Apple Touch Icons)
│       │   ├── assets/          # Static images and branding assets
│       │   └── manifest.json    # Web App Manifest for PWA installation
│       └── src/
│           ├── components/      # Reusable UI Components
│           │   ├── animations/  # Framer-motion page transition wrappers
│           │   ├── ui/          # Low-level UI (Buttons, Inputs, Modals, Toasts)
│           │   ├── AppShell.tsx # Main application layout and sidebar navigation
│           │   ├── LiveMap.tsx  # Leaflet map component for real-time tracking
│           │   └── ...          # Other domain-specific components (SeatMap, Scanner)
│           ├── contexts/        # Global React Contexts
│           │   ├── AuthContext.tsx   # Manages user session, JWT token, and login state
│           │   ├── SocketContext.tsx # Maintains persistent Socket.IO connection
│           │   └── ThemeContext.tsx  # Manages application visual theme (light mode)
│           ├── hooks/           # Custom React Hooks
│           │   ├── useGeolocation.ts # Hook to interface with device GPS
│           │   ├── useScanner.ts     # Hook for ZXing QR code detection
│           │   └── useMap.ts         # Hook for map interactions
│           ├── lib/             # API clients and utilities
│           │   ├── api.ts       # Configured `fetch` wrapper with Auth headers interceptor
│           │   ├── format.ts    # String and date formatting utilities
│           │   └── query.ts     # Data fetching helpers
│           ├── pages/           # Application Pages / Routes (Organized by Role)
│           │   ├── admin/       # Dashboard, User Management, Schedules, Analytics
│           │   ├── driver/      # My Trips, QR Scanner, Incident Reporting
│           │   ├── student/     # Route Booking, Subscriptions, Live Tracking
│           │   └── AuthPage.tsx # Public Login / Registration page
│           ├── services/        # Browser APIs and Background Services
│           │   ├── push.ts      # Web Push Notification subscription handling
│           │   └── sync.ts      # Offline background sync logic (Service Worker)
│           ├── styles/          # CSS Stylesheets
│           │   ├── base.css       # Global resets and CSS variables (Theming)
│           │   ├── components.css # Styles for reusable components
│           │   ├── pages.css      # Layout styles for specific pages
│           │   └── utilities.css  # Helper classes (flex, spacing, text)
│           ├── types/           # Frontend TypeScript interfaces (mirrors API models)
│           ├── App.tsx          # Root Router setup and RBAC Protected Route logic
│           ├── main.tsx         # React application bootstrap and DOM render
│           └── sw.ts            # Workbox Service Worker for PWA capabilities
│
├── docs/                        # 📚 Project Documentation
│   ├── ARCHITECTURE.md          # Deep dive into system design and scaling
│   ├── DEPLOY_FREE.md           # Guide for deploying to free tiers (Supabase + Render)
│   └── assets/                  # Images and diagrams used in documentation
│
├── nginx/                       # 🌐 Reverse Proxy Configuration
│   └── default.conf             # NGINX configuration for routing in production environments
│
├── .env.example                 # Template for required environment variables
├── docker-compose.yml           # Docker orchestration for local development (Postgres)
├── docker-compose.prod.yml      # Docker orchestration for production deployment
├── package.json                 # Monorepo configuration, workspace definitions, and root scripts
└── README.md                    # Project landing page and Getting Started guide
```

---
*Generated for the UniRide Development Team.*
