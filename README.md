# ClinicFlow

A tablet based room signaling and dispatch board, modeled on DoctorFlow, built
for Red Berry Health System and structured so any other Vestra clinic can be
added later with a data insert rather than a code change.

Every physical device (a wall tablet outside a room, the central fishbowl
board, the front desk screen, the waiting room display, and the admin
dashboard) is just a URL under `/c/<clinic-slug>/...`. There is no login.
Supabase Realtime pushes every change to every open screen in well under a
second.

## What's in each folder

```
supabase/schema.sql       All tables, security policies, and the database
                          functions every button in the app calls. Run this
                          once in a fresh Supabase project. Seeds Red Berry
                          with 12 rooms, 3 hallways, 2 nurses, 2 providers.
src/lib/                  Shared types, constants (stage names, thresholds,
                          the one tap request list), and the ClinicProvider
                          that loads a clinic and keeps its rooms, staff, and
                          history live.
src/components/           LiveTimer (ticking, self coloring elapsed time),
                          the role Legend, and the StaffRoster editor.
src/app/c/[slug]/...      The five views: room, board, frontdesk, waiting,
                          admin. [slug] is the clinic's slug (e.g. "red-berry").
```

## 1. Create the Supabase project (free tier)

1. Go to supabase.com, create a new project. Note the project URL and the
   `anon` public API key (Project Settings -> API).
2. Open the SQL Editor in the Supabase dashboard, paste in the entire
   contents of `supabase/schema.sql`, and run it. This creates every table,
   enables Realtime on `rooms` and `calls`, and seeds one clinic: Red Berry,
   12 rooms, hallways Yellow, Blue, Green (4 rooms each), 2 placeholder
   nurses, and 2 placeholder providers.
3. Rename the placeholder staff, or add up to 6 of each, right from the app:
   open Admin, "Providers and nurses". No need to touch the database
   directly anymore.

## 2. Run it locally

```bash
cp .env.example .env.local
# edit .env.local with your Supabase URL and anon key
npm install
npm run dev
```

Open `http://localhost:3000`. It lists clinics from your database. Click
into Red Berry, or go straight to `http://localhost:3000/c/red-berry/board`.

## 3. Deploy for real (so physical tablets can reach it)

Push this folder to a GitHub repo, then in Vercel: **New Project, import
that repo**. Add the same two environment variables
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) in Vercel's
project settings, then deploy. Vercel's free tier and Supabase's free tier
together cover this at $0 a month at the traffic levels one clinic generates.

Point each wall tablet's kiosk browser at:

- `https://<your-vercel-domain>/c/red-berry/room/1` (and `/room/2`, `/room/3`,
  and so on, one tablet per room, each pinned to its own room number)
- `https://<your-vercel-domain>/c/red-berry/board` for the hallway or
  fishbowl display
- `.../frontdesk` for the check in desk
- `.../waiting` for the waiting room monitor
- `.../admin` for whoever reviews timing and manages staff

## 4. Adding a second clinic later (Gun Lake, Tunica, and so on)

No code change. Copy the `do $$ ... $$` seed block at the bottom of
`supabase/schema.sql`, give it a new slug, name, and room count, and run it
in the SQL Editor. It shows up immediately on the home page and at
`/c/<new-slug>/board`, and so on. Each clinic manages its own provider and
nurse roster from its own Admin page after that.

## How the colors work

Color is by role, not by person: every provider is blue, every nurse is
green, everywhere in the app, no matter which of up to 6 providers or 6
nurses is actually on duty. The front desk can assign a specific named
person to a room, or leave it as "Any nurse" or "Any provider", and either
way the color stays the same. The specific name, when there is one, shows as
text next to the room so staff can get more specific without needing to
memorize a color per person. Housekeeping (needs cleanup) and contamination
lockout each get their own fixed color too.

## How the timer coloring works

Every elapsed time reads in the normal text color while a room is running
normally. Once a step has at least 20 completed instances in the trailing
30 days, the app compares the current room against that clinic's own recent
average for that exact step: 20% over average turns the time yellow, 50%
over turns it red. Until a step has that much history (a brand new clinic,
or a step that rarely happens), it falls back to fixed minute thresholds
instead, listed at the bottom of the Admin page. Averages refresh about once
a minute, so a newly completed visit affects the color within a minute, not
instantly.

## Known simplifications, called out on purpose

- **No login, by design.** This matches the spec ("open device access") and
  the answer given when asked. In practice that means anyone who has the
  anon key (which ships in the browser bundle, that is normal for Supabase)
  can read and write every room. The realistic mitigation is not a login
  screen, it is keeping the tablets' URLs off anything public and treating
  the deployed URL like a shared clinic Wi-Fi password. If that ever feels
  insufficient, the next step up, still short of full user accounts, is a
  single shared passcode gate in front of the whole app. Ask and it can be
  added.
- **Doctor idle time is a real calculation**, not an estimate: the gap
  between the end of one visit and the start of a provider's next one,
  counted only within the same day so overnight and weekend gaps never
  count. Visits staffed as "Any provider" are not attributed to anyone.
- **Urgent items flash, they do not chime** (chaperone requests and
  contamination lockout pulse red on the board), no audio, per the earlier
  answer.
- **Kiosk lockdown is not part of this repo.** For Fire HD 10 tablets, Fully
  Kiosk Browser (free) pointed at the tablet's URL, with "Ask before wake"
  and "Auto return to Kiosk" enabled, is the standard approach. Happy to
  write the exact settings once the hardware is confirmed.
