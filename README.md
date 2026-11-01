# Class Hub

Static site (no build step) + Firebase Auth & Firestore.
- `/`      → students register / log in, read notices & courses, post comments
- `/admin` → CR/admin login and control panel (add/delete courses, notices, comments)

## 1. Firebase setup (5 min)
1. https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (production mode).
4. Firestore → **Rules** tab → paste the contents of `firestore.rules` → **Publish**.
5. **Project settings → Your apps → Web (</>)** → copy the config into `public/firebase.js`.

## 2. Make someone an admin (manual, only you can do this)
1. Have the CR register on the student page (`/`) first.
2. Firebase Console → Authentication → Users → copy their **User UID**.
3. Firestore → **Start collection** `admins` → Document ID = that UID → add any field (e.g. `role: "cr"`) → Save.
4. They can now log in at `/admin`.

## 3. Deploy
**Vercel:** push to GitHub → vercel.com → Import repo → Deploy (settings are in `vercel.json`).
**GitHub Pages:** repo Settings → Pages → Source: GitHub Actions; the workflow deploys `public/`.

Then Firebase → Authentication → Settings → **Authorized domains** → add your site's domain.

## Seed data
The course table from your Google Doc goes in via `/admin → Courses`.

## Tabs
Students and admins see: **Classroom · Class Tests · Tasks · Notices · Comments** (admin also has **Import**).
- **Class Tests** shows every task whose type is *Class Test*. **Tasks** shows all the other types (assignment, quiz, exam, lab, class, other).
- In the admin **Class Tests** tab the add form is already set to *Class Test* and *All day*, so you only type the title, course, date and syllabus.
- Both tabs read the same `tasks` data, so the JSON import, paste import, status picker and Edit work the same in each. The type decides the tab.

## Tasks & auto rules
Admin → **Tasks** (or **Class Tests**) → add an assignment / **class test** / quiz / exam with a start (due) time and optional end time.
- **Class tests:** pick the type **Class Test**. Class tests usually have a date but no time, so tick
  **All day, no specific time**. The card then shows the date with "All day", the badge reads **Today** on the day,
  and it turns green after midnight. Google Calendar and `.ics` get a proper all-day event
  (the `.ics` reminder rings at 09:00 the day before).
- **Add to Google Calendar:** every task has a 📅 button that opens Google Calendar with the event pre-filled
  (plus a `.ics` download with a 30-min reminder for Apple/Outlook). No Google login or API setup needed.
- **Auto colours:** purple = upcoming, amber = due within 24h, cyan = happening now,
  green ✓ = done (after the end time, or start + 1 hour if no end is set). Cards re-check every 30 seconds
  and move to the bottom once done. Nothing to click.
- **Update the rules:** re-paste `firestore.rules` in Firebase → Firestore → Rules → Publish (adds `tasks`).

## Set the status by hand
Admin → **Tasks**: every task card has a **status picker** and an **Edit** button.
- **Auto (by time)** is the default: upcoming, due within 24h, happening now, done after the end.
- **Upcoming / Due soon / Rescheduled / Done** are set by you and stay until you change them. Students see the same badge and colour
  (Rescheduled is purple). Done tasks move to the bottom of the student list and lose their calendar buttons.
- **Edit** opens the whole task (title, type, course, date, all day, details, status) so you can move a date and mark it Rescheduled in one save.
- JSON and pasted tables can also carry `"status": "rescheduled"` (or upcoming, due soon, done).

## Import JSON files (many at once)
`/admin → Import → Import JSON files`: choose or drag in as many `.json` files as you like. One file can hold
`courses`, `tasks` and `notices` together. You get a preview (what will be imported, what is skipped and why) before anything is saved.
- **Skip items that are already on the site** is ticked by default, so importing the same file twice does not create copies.
- A bad file (not JSON, wrong shape) is shown with its error and left out. The good files still import.
- Dates: `"2026-11-09"` is an all-day task (use it for class tests); `"2026-11-12 23:59"` is timed; `"end"` is optional.
- `data/class-hub-data.json` is the ready-made file made from the Google Doc PDF. **Download example file** (in the same
  panel) shows the format. The code that reads these files is `public/data-format.js`.

## Import from your Google Doc
`/admin → Import`: pick Classroom, Tasks or Notices, then copy the table from the Google Doc (or Sheet) and paste it in.
The first row must be column names (e.g. Course, Code, Credit, Teacher, Phone / Email, Office hours, Google Classroom code).
Preview shows what was found; click Import. For tasks use dates like `2026-11-10 14:00`, or just a date for an all-day task.
For the **Class Tests** table from the doc, choose **Class tests (CT table)**: the `CT No.` column becomes the title, `Syllabus` becomes the details,
and every row gets the type Class Test.

## Google login and password reset
1. Firebase → Authentication → Sign-in method → Add new provider → **Google** → Enable → pick a support email → Save.
2. Your site's domain must be in Authentication → Settings → Authorized domains (same step as before).
3. Password reset needs no setup. "Forgot password?" sends Firebase's reset email. Edit its wording under
   Authentication → Templates. People who signed up with Google reset their password with Google, not here.
4. A CR who logs in with Google becomes an admin the same way: copy their UID from Authentication → Users and create `admins/<UID>`.
