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

## Tasks & auto rules
Admin → **Tasks** → add an assignment / quiz / exam with a start (due) time and optional end time.
- **Add to Google Calendar:** every task has a 📅 button that opens Google Calendar with the event pre-filled
  (plus a `.ics` download with a 30-min reminder for Apple/Outlook). No Google login or API setup needed.
- **Auto colours:** purple = upcoming, amber = due within 24h, cyan = happening now,
  green ✓ = done (after the end time, or start + 1 hour if no end is set). Cards re-check every 30 seconds
  and move to the bottom once done. Nothing to click.
- **Update the rules:** re-paste `firestore.rules` in Firebase → Firestore → Rules → Publish (adds `tasks`).

## Import from your Google Doc
`/admin → Import`: pick Courses / Tasks / Notices, then copy the table from the Google Doc (or Sheet) and paste it in.
The first row must be column names (e.g. Course, Code, Credit, Teacher, Phone / Email, Office hours, Google Classroom code).
Preview shows what was found; click Import. For tasks use dates like `2026-11-10 14:00`.
