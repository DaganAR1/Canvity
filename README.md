# Canvity

Canvity reads your Canvas assignments, ranks them by what actually needs doing first,
lays them out on a timeline, and reminds you before things are due.

- **Syncs from Canvas** — pulls your active courses, assignments, due dates, point values,
  assignment-group weights, and submission status via the Canvas REST API.
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

Deploy to Vercel and set the same environment variables in the project settings.
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
UTC day per user.

> **Note on digest timing:** `digestHour` is stored in UTC. A user wanting 7am local
> needs to pick the corresponding UTC hour.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind · Prisma + Postgres · NextAuth (credentials)
· web-push (VAPID) · Resend
