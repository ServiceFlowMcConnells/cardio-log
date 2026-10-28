# Training Log

A Strong-style strength and cardio logger with a rules-based coach and readiness scan. Phone-first; add it to your home screen.

Live at https://training-log-coach.vercel.app

- **Week**: minutes against your weekly target, zone time, minutes per day.
- **Log**: a session is one or more treadmill/bike blocks. New blocks pre-fill last time's settings. Built-in timer. Drafts survive a reload.
- **Progress**: weekly minutes, output per heartbeat (treadmill METs per 100 bpm, bike watts per bpm), benchmark tests, records.
- **Settings**: weekly target, max HR and zone, CSV export.

Stack: Vite + React + TypeScript, Supabase (auth + Postgres with row-level security), deployed on Vercel.

Single-owner app: the `create-account` edge function creates the first account without a confirmation email; a database trigger blocks any further sign-ups.

```
npm install
npm run dev
```
