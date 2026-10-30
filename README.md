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
supabase/update_2026_10_27.sql
supabase/update_2026_10_27b.sql
supabase/update_2026_10_28.sql
supabase/update_2026_10_30.sql
                          (the latest, "update 4". It includes everything in
                          update 3, so it is safe whether or not update 3 ran). Upgrades for a project that already ran an older
                          schema.sql. Run them in order in the SQL editor,
                          BEFORE deploying the matching code. Each is safe
                          to run more than once.
src/lib/                  Shared types, constants (stage names, thresholds,
                          the one tap request list), and the ClinicProvider
                          that loads a clinic and keeps its rooms, staff, and
                          history live.
src/components/           LiveTimer (ticking, self coloring elapsed time),
                          the role Legend, and the StaffRoster editor.
src/app/c/[slug]/...      The six views: room, board, frontdesk, waiting,
                          lab (DLO pickup and call with results), admin. [slug] is the clinic's slug (e.g. "red-berry").
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

## Shots, Other, DLO pickup, and call with results

- **Visit stage.** While the provider is in the room, the tablet offers
  Shots, Other, and Check-out. After Shots or Other the room offers
  Check-out again. Shots and Other are nurse tasks (green) and are timed as
  their own steps on the Admin page. "Other" behaves exactly like Shots.
- **Prepping** shows "Nurse in progress" (the nurse is in the room) instead
  of "Nurse needed".
- **DLO pickup.** Turning on Throat culture, Strep culture, Viral panel or
  Send out lab adds the sample to today's list on the Lab and calls tab.
  Step 1 marks each sample as in the pickup box. Step 2 marks that DLO was
  called. Samples never marked as in the box carry over in red the next day.
  "Today" follows the clinic's time zone (clinics.timezone, default
  America/Chicago).
- **Call with results.** If RSV, Flu, Strep or COVID is still marked on the
  room when Check-out is tapped, the tablet asks whether to add the
  patient to the Call with results list. Staff tap "Results in, call now"
  when the result is back, then "Called". The list holds only the ticket
  number, room and tests, never a name or phone number. Waiting and ready
  timers turn yellow and red using the placeholder minutes at the bottom of
  src/lib/constants.ts.
- Each button tap sends the stage the tablet was showing, so a double tap or
  two tablets pressing at once cannot skip a step.
- "Rooms in service" on the Admin page now hides unused rooms on every view.

## Initials, check-out, follow up, and "I've got it"

- **Initials.** The front desk types the patient's initials (letters, up to
  4) before tapping a vacant room. They show on the room, the board, the
  waiting room screen and the Lab and calls lists, and stay with the room
  until check-out. Initials are a patient identifier stored in an open,
  no login database, so have your privacy officer approve this before real
  patients are entered.
- **Check-out.** Replaces "Pt departed" in the room. There is no cleaning
  step: the room goes straight to Vacant (use Contamination lockout for a
  deep clean), the patient moves to a "Checking out" list on the waiting room
  screen and the front desk, and the room is cleared of initials, requests
  and messages. Tapping **Pt departed** there removes the patient and their
  initials for good.
- **Follow up.** "Schedule a follow up visit" in each room: 1 week, 3
  months, 6 months or other, plus weight check, asthma, medication f/u or
  generic. It follows the patient to the front desk's Checking out list.
- **I've got it.** Every request, message, Shots and follow up shows an
  "I've got it" button. The person picks their name from the roster or types
  one, and "Name has it" shows on the room and board. The button is on
  both the board card and the room page.
- **Fishbowl colors.** The whole square is one solid color: white when
  vacant, light gray when occupied, blue at Ready for doctor, red in
  Contamination lockout. There are no role colors or legend any more.
- **Flashing.** The whole square blinks between its own color and the flash
  color: blue for tests and support requests, pink for Shots, orange for a
  message, until each has an "I've got it". When the flash color matches the
  square (a test on a blue square, or lockout on the red square) it blinks
  with white. Contamination lockout flashes red. Follow up requests do not
  flash. Squares are all the same size and fill the screen.
- **Prep nurse.** Start prep records the nurse's name (from "Who are you?",
  or a picker if no name is set) and the board shows "Nurse in progress: name".
- **Change room.** A button on the room page and on each occupied row of the
  front desk's Rest of the floor list moves a checked in patient to a vacant
  room, keeping initials, ticket, step, timer, requests, message and follow
  up. The old room goes back to Vacant.
- **Who are you.** "Who are you?" at the top of every page: pick a name from
  the roster or type one. It is remembered on that device, and "I've got it"
  then uses it in one tap. If no name is set, the button asks.
- **Provider at check in.** A provider dropdown next to the initials box:
  the room's usual provider, any provider, or a specific person.
- **Follow up reasons** include WCC, plus a free text note that goes to the
  front desk. **Call with results** tasks have a free text Results box.
- **Timing averages** (Admin). Reset 30 day averages starts the averages
  fresh from now and keeps the old data. Erase all timing history deletes it
  for good, after a warning to verify with your administrator.
- **Reset for the day** (Admin) sends all rooms to Vacant, clears the
  Checking out list and restarts ticket numbers. History, lab samples and
  open results calls are kept.
- **Roster.** Providers (up to 6), nurses (up to 20) and Front desk (up to
  20). Front desk names can pick themselves for "I've got it".
- **Timers.** Step timers run from the moment a room enters a step. Vacant
  rooms show no timer. To hide
  them for the first few minutes instead, change TIMER_VISIBLE_AFTER_MIN in
  src/lib/constants.ts (for example to 5).
- **Directions.** Door directions per room are edited in Admin and shown to
  patients on the front desk and waiting room screens.
- Rooms on the board open that room's tablet page when tapped.

## How the colors work

On the Fishbowl board the color shows the room's status: white vacant (and
"Turning over"), gray occupied, blue ready for the doctor, red contamination
lockout. A flashing square means someone is being asked for something (see
Flashing above): tests, support requests and messages blink yellow, Shots
blink pink, a lockout blinks red. Every occupied square shows the visit's
provider in their name color (set per provider in Admin, Setup tab, next to
each provider; a provider with no color shows in dark gray).

## How the timer coloring works

Timers use fixed minutes per step that you set in Admin, Setup tab, "Timer
colors". A timer turns yellow after the yellow minutes and red after the red
minutes. Starting values (yellow / red): Ready for nurse 5 / 8, Prepping 8 / 12,
Ready for doctor 10 / 15, Doctor in room 20 / 30, Shots 10 / 15, Other 10 / 15.
The numbers are saved in the database (clinics.timer_targets), so every screen
uses the same ones. Averages no longer change the colors.

## Update 4 behavior

- **Check out and turnover.** Check out puts the room in "Turning over" for
  2 minutes (2:00 countdown on the board), then it shows as vacant by itself.
  The front desk can check a patient into a turning over room right away.
  "Undo check out" on the room page works during those 2 minutes, until a new
  patient is checked in or Pt departed is tapped.
- **Go back one step.** On the room page, with a confirm. The step that was
  tapped by mistake is removed from the timing history and the timer picks up
  from the original start of the earlier step. Not available at Ready for nurse.
- **Provider for the visit.** Each patient has their own provider (check in
  box). It can be changed on the room page or in the front desk table. The
  room's usual provider in Today's staffing is never overwritten, and Change
  room moves the visit's provider with the patient.
- **Admin, Tracker tab.** Pick a date. Tables show That day, Last 7 days, Last
  30 days and All time for step times, door to door time, provider visits
  (with per clinic day averages) and swab counts (RSV, Flu, Strep, COVID,
  Throat culture, Strep culture, Viral panel). Steps over 3 hours are left out
  of time averages. "Reset 30 day averages" restarts only the Last 30 days
  columns. "Erase all timing history" erases the Tracker too, and cannot be
  undone. The Tracker stores counts and times only, never initials.
- **Staying up to date.** Every screen refetches rooms, staff and settings
  every 30 seconds, when the tab comes back, and when the network returns, and
  reconnects its live connection by itself. The header shows "Updated X ago"
  and turns red only after 4 minutes without a successful sync. The Fishbowl
  board also reloads the whole page every 5 minutes as a safety net. Set the
  big screen computer to never sleep.

## If the home page says "No clinics yet" or shows a permission error

Supabase projects created after May 30, 2026 do not expose new tables to the
app automatically, so the app needs explicit permissions. `supabase/schema.sql`
now includes them (the "grants" section near the bottom). If you ran an older
copy of the schema, open the Supabase SQL Editor and run just these four lines,
then refresh the page. No redeploy needed:

```sql
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
```

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
- **Urgent items flash, they do not chime** ("Call nurse", results
  ready to call, and contamination lockout pulse red on the board), no audio, per the earlier
  answer.
- **Kiosk lockdown is not part of this repo.** For Fire HD 10 tablets, Fully
  Kiosk Browser (free) pointed at the tablet's URL, with "Ask before wake"
  and "Auto return to Kiosk" enabled, is the standard approach. Happy to
  write the exact settings once the hardware is confirmed.
