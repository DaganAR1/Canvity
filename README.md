# Canvity

Canvity reads your Canvas assignments, ranks them by what actually needs doing first,
lays them out on a timeline, and reminds you before things are due.

- **Syncs from Canvas** — pulls your active courses, assignments, due dates, point values,
  assignment-group weights, and submission status via the Canvas REST API.
- **Scans your syllabi** — finds each course's syllabus (the Canvas page or an uploaded
  PDF) and pulls out exam dates, project milestones, drop deadlines, and policies. These
  are the deadlines that never become Canvas assignments, which is exactly why they get
  missed. Dated ones join your timeline.
- **Ranks by priority, not just date** — a 200-point midterm tomorrow outranks a 10-point
  discussion post due today, and a major project surfaces days before a small one does.
- **Timeline view** — grouped into Overdue / Today / Tomorrow / This week / Next week /
  Later, sorted by priority inside each group. Submitted work drops off automatically.
- **Notifies you** — browser push 24h before anything is due (plus early warnings on
  critical work) and an optional daily email digest of your top 10.

## How priority is scored

Each unsubmitted assignment gets a 0–100 score built from two independent parts:

| Input | Where it comes from | Effect |
| --- | --- | --- |
| **Urgency** | Time until `due_at` | Decays exponentially. Overdue or due-now = 100. |
| **Importance** | Assignment group weight (preferred) or points possible | Sets the score's amplitude. |
| **Course weight** | You, in Settings | Scales importance only — never urgency. |

Two details make the ranking behave the way a student would expect:

- **Importance never inflates urgency.** Marking a course "High" can't promote busywork
  above a genuinely imminent deadline.
- **Big assignments get more runway.** Urgency decays more slowly the more an assignment
  is worth, so a term paper climbs the list a week out while a quiz worth the same score
  today doesn't.

Scores map to tiers: `critical` (≥65), `high` (≥45), `normal` (≥20), `low`. Anything
overdue and unsubmitted is always `critical`.

## Syllabus scanning

Open **Syllabus** in the nav and scan a course. Canvity looks for the syllabus in two
places, preferring an uploaded file since instructors who upload one usually leave the
Canvas page as a stub pointing at it:

1. A course file whose name contains "syllabus" (PDF, text, or HTML)
2. The course's Canvas syllabus page

The text (or the PDF itself) goes to Claude, which returns structured items: dated ones
(exams, milestones, drop deadlines) and undated ones (grading breakdown, late-work
policy, required materials). Dated items join the timeline with a **Syllabus** badge and
are scored on the same curve as assignments, using the importance the syllabus implies.

A few details worth knowing:

- **Bare dates get anchored.** Syllabi write "Oct 3", not "2026-10-03". Canvity passes the
  first and last due dates of the course's known Canvas assignments as a term window so
  the year resolves correctly, and instructs the model never to invent a date it can't
  pin down.
- **Re-scanning is free when nothing changed.** The syllabus text is hashed, and an
  unchanged hash skips the extraction call. "Rescan" forces one anyway.
- **Optional items never push.** Something the syllabus marks as low importance (an
  optional reading) still appears on the timeline and in the digest but will not trigger a
  notification.
- **Re-scanning replaces** that course's items, so edits to a syllabus don't leave stale
  dates behind.

Scanning requires `ANTHROPIC_API_KEY`. Everything else in the app works without it.

## Setup

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```bash
# Secrets — run each of these and paste the output
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY  (must be exactly 32 bytes)
openssl rand -base64 32   # CRON_SECRET

# Web push keys (writes all three VAPID values)
npm run generate-vapid-keys
```

`DATABASE_URL` points at any Postgres instance (Vercel Postgres, Supabase, Neon, or local).
`RESEND_API_KEY` and `EMAIL_FROM` are only needed for email digests — push works without them.
`ANTHROPIC_API_KEY` is only needed for syllabus scanning.

### 2. Create the database schema

```bash
npm run db:migrate
```

### 3. Run it

```bash
npm run dev
```

Sign up, then go to **Settings → Canvas connection**.

### 4. Get your Canvas token

In Canvas: **Account → Settings → New Access Token**. Copy it into Canvity along with
your school's Canvas domain (e.g. `myschool.instructure.com`). The token is encrypted
with AES-256-GCM before it's stored, and never leaves the server afterwards.

## Deploying

The build script (`prisma generate && prisma migrate deploy && next build`) applies
pending migrations automatically, so a fresh Postgres database — an empty Supabase
project, for instance — ends up fully set up with no manual migration step.

1. On [vercel.com](https://vercel.com), **Add New... → Project**, import this repo.
2. Before deploying, expand **Environment Variables** and add:
   - `DATABASE_URL` — your Postgres connection string
   - `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` — each `openssl rand -base64 32`
   - `NEXTAUTH_URL` — a placeholder is fine for the first deploy; fix it in step 4
3. **Deploy**. Vercel only builds on a push to the connected branch — if the project
   was created without an initial build (no deployments listed at all, "Create
   Deployment" doesn't appear anywhere), push any commit to trigger one; there's no
   button for a from-scratch first deploy when the repo already existed pre-import.
4. Once it succeeds, copy the real URL Vercel assigned, set that as `NEXTAUTH_URL` in
   Environment Variables, and redeploy once more so the login flow uses the right URL.

`vercel.json` already registers three cron jobs:

| Schedule | Endpoint | Job |
| --- | --- | --- |
| Every 4 hours | `/api/cron/sync` | Pull fresh Canvas data for every connected account |
| Every 30 min | `/api/cron/notify` | Send push reminders for due-soon and critical work |
| Hourly | `/api/cron/digest` | Send each user their daily digest at their chosen hour |

All three require `Authorization: Bearer $CRON_SECRET`, which Vercel Cron sends
automatically. You can trigger one by hand to test:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/sync
```

Notifications are de-duplicated per assignment via the `NotificationLog` table, so a
30-minute cron never sends the same reminder twice. Digests are guarded to once per
calendar day *in the user's own timezone*, so a user near a UTC day boundary can't be
sent two digests in one local day, or skipped in another.

## Timezones

Every user has a `timeZone` (IANA name, e.g. `America/Los_Angeles`), set in Settings —
auto-detected from the browser with a one-click "use this" prompt when it differs from
what's stored, defaulting to UTC until then. It's the single source of truth for:

- **The timeline's Today/Tomorrow/This week buckets** — grouped by calendar day in the
  user's zone, not elapsed hours, so DST transitions (which make some local days 23 or
  25 hours long) can't shift anything into the wrong bucket.
- **`digestHour`** — a wall-clock hour *in that zone* ("7" means 7am for that user), not
  UTC. The digest cron runs hourly and fetches every enabled user to check in JS, since
  "match this hour in each user's own zone" can't be expressed as a single SQL filter.
- **Syllabus dates.** A syllabus writes "2pm" for whoever's enrolled, not in UTC, so a
  timed item ("Dec 15 at 2pm") is resolved against the course owner's `timeZone` into a
  real instant. A bare date ("Oct 3", no time) is genuinely different — it names a
  calendar date, not an instant — and is stored as a marker (`isAllDay: true`) rather
  than guessed at as midnight-something. Bucketing and display both check `isAllDay` and
  handle the two cases separately; scoring treats an all-day item as due through the end
  of that day in the owner's zone, not as expiring at its raw stored marker (which would
  otherwise read as overdue for most of the day it's actually due).

## Tech stack

Next.js (App Router) · TypeScript · Tailwind · Prisma + Postgres · NextAuth (credentials)
· web-push (VAPID) · Resend · Anthropic SDK (Claude Opus 5, structured outputs)
