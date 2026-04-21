# Workspace

## GitHub Policy
- **Do NOT auto-push to GitHub** — user handles all GitHub pushes manually
- Never run `git push` unless explicitly asked by the user

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Framer Motion

## Applications

### Event Manpower Agency (`artifacts/manpower-agency`)
A full-stack event manpower management platform with:
- **Crew Features**: Registration (multi-select role checkboxes with amber warning for multiple roles + custom "Other" field), profile management, browse/claim shifts, earnings & payment tracking, 4-button attendance (Check In / Break Start / Break End / Check Out). Rejected crew receive WhatsApp link to edit form prefilled with existing data + rejection reason banner.
- **Admin Features**: Approve crew registrations (with rejection reason dialog + WhatsApp message), manage events & shifts, approve shift claims, process payments, attendance management with edit times / mark absent / event settings. "Resubmitted" status shown in orange with rejection reason banners for review.
- **Auth**: Session-based auth (bcryptjs + express-session), role-based routing (admin/crew)
- **Attendance system**: Event-based, break tracking (breakStartAt/breakEndAt/totalBreakMinutes), late threshold per event, auto-summary, admin can edit all times

**Default Credentials:**
- Admin: `nirmol@goteamcrew.com` / `Hr51bd7491@`
- Crew can self-register at `/register`

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server (shared backend)
│   └── manpower-agency/    # React + Vite frontend
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/     # users, crew, events, shifts, payments tables
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

- `users` — auth table with roles (admin/crew) and statuses (pending/approved/rejected/resubmitted/active/blacklisted)
- `crew_profiles` — crew extended profiles (phone, gender, skills, experience, bank_account, earnings, wallet_balance, total_referrals, successful_referrals, custom_role, rejection_reason)
- `events` — event listings (title, location, dates, client, gender_required, food_provided, meals_provided, incentives, referral_reward)
- `shifts` — shift slots per event (role, times, hourly rate, spots)
- `shift_claims` — crew claiming shifts (pending/approved/rejected); includes `checkedInAt`, `checkInStatus` (on-time/late), `checkInLat/Lng`, `selfieImage`, `isAbsent`, `checkOutAt`, `checkOutStatus`
- `payments` — payment records per crew (pending/processing/paid/failed)
- `referrals` — referral tracking (referrer_id → crew_profiles, event_id → events, referral_code, status pending/joined/successful, reward_amount)

## API Routes

All routes prefixed with `/api`:

**Auth**: `POST /auth/login`, `POST /auth/register`, `POST /auth/logout`, `GET /auth/me`
**Crew**: `GET/PUT /crew/profile`, `GET /crew/shifts`, `GET /crew/earnings`
**Events**: `GET /events`, `POST /events`, `GET/PUT/DELETE /events/:id`
**Shifts**: `GET /shifts`, `POST /shifts`, `GET/PUT/DELETE /shifts/:id`, `POST /shifts/:id/claim`, `POST /shifts/:id/unclaim`
**Payments**: `GET /payments`, `POST /payments`, `PUT /payments/:id`
**Admin**: `GET /admin/crew`, `POST /admin/crew/:id/approve|reject`, `GET /admin/shift-claims`, `POST /admin/shift-claims/:id/approve|reject`, `GET /admin/stats`
**Referrals**: `POST /referrals`, `GET /crew/referrals`, `GET /leaderboard`

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client from openapi.yaml
- `pnpm --filter @workspace/db run push` — sync DB schema changes
