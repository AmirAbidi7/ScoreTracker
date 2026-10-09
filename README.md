# PlayBoard

Live score-tracking for game night. Create a board, share its 6-character
code, and everyone on the code watches the same scores update in real time.
Guests can watch a board without signing in — they just can't change it.

## Tech stack

- **Backend** — Express 5, Effect 4, Drizzle ORM, PostgreSQL 17, socket.io
- **Frontend** — Expo SDK 57 (React Native + Web), expo-router, Redux Toolkit,
  NativeWind, Clerk for auth
- **Local DB** — PostgreSQL via `docker-compose.yml`

## Features

- **Boards** — create a board with players and scores; each board gets a
  unique 6-character code (`[a-z0-9]{6}`) that friends use to join.
- **Live updates** — everyone on the same code sees score changes instantly
  over a websocket; sessions persist across restarts.
- **QR codes** — a board's code is shown as a scannable QR on the scoreboard
  screen, and the Join tab can scan a QR to join that board (with torch
  toggle and camera-permission handling).
- **Auth + ownership** — email, Google, and Apple sign-in via Clerk with
  custom UI in the app's theme. Signed-out users watch live; signed-in users
  can claim an ownerless board, joiners can edit scores, and only the owner
  can delete the board.
- **Leaderboard** — standings view alongside the scoreboard and join tabs.

## Running it

```bash
docker compose up -d          # local PostgreSQL (maindb)

cd backend && bun install
DATABASE_URL=postgres://main:main@localhost:5432/maindb bun index.ts

cd frontend && bun install
bunx expo start               # scan the QR with Expo Go
```

Copy `backend/.env.example` to `backend/.env` for server config (always point
`DATABASE_URL` at the local container, never the shared remote DB).
Frontend keys (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`)
live in `frontend/.env`, with machine-specific overrides in `.env.local`.
Empty Clerk key = signed-out view-only mode.

```bash
cd backend && bun test        # backend suite
cd frontend && bun run test   # frontend suite (jest)
```
