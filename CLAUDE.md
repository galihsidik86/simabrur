# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A full-stack implementation-in-progress of **"Safar"** — a Sistem Informasi Manajemen Travel Haji & Umrah (Hajj & Umrah travel management system) — built from the design/specification package that also lives in this repo. All content is in Indonesian.

Two layers coexist here:

1. **Design mockups & specs** (`*.dc.html` + `support.js`/`doc-page.js`, plus a zip snapshot) — the source of truth for UI and business rules. Read-only reference; do not modify.
2. **Application code** — npm workspaces monorepo: `backend/` (Express 5 + TypeScript + Knex + PostgreSQL) and `frontend/` (React 18 + Vite + Tailwind v4). Built phase-by-phase per **PLAN.md**; work strictly follows those phases and stops for user confirmation between phases.

## Commands

```bash
npm install                # root, installs both workspaces
docker compose up -d db    # PostgreSQL 16 on host port 5434 (5432/5433 are taken by other local services)
npm run migrate            # Knex migrations (backend/src/db/migrations)
npm run seed               # seed roles/users/demo data
npm run dev:backend        # API http://localhost:3001
npm run dev:frontend       # Web http://localhost:5173 (proxies /v1 to backend)
npm test                   # Vitest + supertest, uses safar_test DB in the same container
npm run build              # production build: backend tsc + frontend vite → backend/public
npm run db:backup          # pg_dump -Fc via docker → backups/
# Production: docker compose -f docker-compose.prod.yml up -d --build (see README "Deployment")
```

Demo accounts: `admin@safar.co.id` etc., password `safar123` (see README.md).

## Application conventions

- API envelope `{success, data, meta}` / `{success:false, error:{code,message}}`; camelCase JSON, snake_case DB columns; module layout `backend/src/modules/<mod>/{routes,controller,service,repository,validation}.ts`
- Design tokens live in `frontend/src/styles/tokens.css` (@theme) — extracted 1:1 from the mockups; never invent new visual values, match the mockup
- Accounting rules (PSAK 72, account 2-1100 liability, cost center per departure, balanced journals) are non-negotiable — see PLAN.md §4

## Viewing and editing pages

- Open any `.dc.html` file in a browser (e.g. `start ".\Aplikasi Travel.dc.html"`). **Internet access is required**: `support.js` loads React 18 UMD and Babel from unpkg at runtime.
- Edit the HTML/template or the data script, then reload the browser. No compile step.
- Do not edit `support.js` (generated from `dc-runtime/src/*.ts`, per its header) or the scaffold logic in `doc-page.js`.

## The .dc.html file format

Each page is a self-contained "design canvas" document rendered by `support.js`:

- Markup lives inside an `<x-dc>` element; `<helmet>` inside it holds head content (fonts, global CSS).
- Template syntax: `{{ expr }}` bindings, `<sc-for list="{{ items }}" as="it">…</sc-for>` loops, `<sc-if value="{{ cond }}">…</sc-if>` conditionals, `onClick="{{ handler }}"` events, `style-hover` for hover styles.
- Data and behavior come from a `<script type="text/x-dc" data-dc-script>` block defining `class Component extends DCLogic` whose `renderVals()` returns the object consumed by the bindings. Style strings (e.g. `h2`, `pre`) are commonly passed as values and injected into `style="{{ h2 }}"`.
- Document-style pages (e.g. Handoff Developer) wrap content in `<x-import component-from-global-scope="doc-page" from="./doc-page.js">` — a printable page shell (A4/letter, print margins, header/footer slots) for PDF export.

## What each page contains (the spec)

- **Handoff Developer.dc.html** — the source of truth for the planned system: tech stack (Node.js/Express REST API, React + Tailwind SPA, PostgreSQL, JWT + RBAC), modular-monolith folder layout (controller → service → repository per module), API conventions (`https://api.safar.co.id/v1`, camelCase JSON bodies / snake_case DB columns, response envelope `{ success, data, meta }`, Idempotency-Key on payment POSTs), full endpoint list per module, roles, and a 6-phase implementation roadmap.
- **ERD Sistem Travel.dc.html** — the complete data model. Tables and FK relationships are defined as data in the script's `tables()` and `edges()` methods; edit those (not the SVG code) to change the ERD.
- **Aplikasi Travel.dc.html** — the main admin app mockup (dashboard, sidebar nav across modules).
- **Chart of Accounts / Input Transaksi / Jurnal Rekonsiliasi / Laporan Keuangan** — accounting module mockups.
- **Pendaftaran Jamaah / Portal Jamaah / Invoice Kwitansi / Laporan Operasional** — pilgrim registration, self-service portal, invoice/receipt, and operations report mockups.

## Domain rules to preserve across pages

The business modules are: Paket & Jadwal, Jamaah & Pendaftaran, Pembayaran, Operasional & Manifest, Marketing & Komisi, Keuangan & Akuntansi, Laporan. Key accounting rules baked into the design (keep mockups consistent with these):

- Pilgrim receipts are booked as a liability — **Uang Muka Jamaah (2-1100)**; revenue is recognized at departure (PSAK 72).
- Foreign-currency transactions are recorded in functional currency IDR via an exchange rate; FX differences go to account **7-1000**.
- Every departure is a **cost center**; journals are generated automatically from transactions.
- Roles: Admin, Marketing, Operasional, Keuangan, Pimpinan (read-only), Jamaah (portal only).

Visual language shared by all pages: cream/dark-green palette (`#efe8da` background, `#16211b` dark green, oklch accent colors per module), Marcellus (headings), Plus Jakarta Sans (body), JetBrains Mono (numbers/code).
