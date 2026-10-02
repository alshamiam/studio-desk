# Studio Desk

Timetable, attendance register, lesson packages and makeups for the music studio.
Replaces the old "Schedules and attendance" spreadsheet.

- **Frontend:** plain JavaScript + Vite, deployed on Vercel
- **Database & login:** Supabase (Postgres + Auth), project `signs-and-more` (`amlujxkytsgpqhtlktrx`)

## Screens

| Tab | What it does |
| --- | --- |
| Today | Each teacher's lessons for the day with one-tap Present / Absent / No-show / Cancelled, plus a "Needs attention" list (finished or low packages, unmarked lessons, makeups owed, unpaid, clashes, unsigned forms) |
| Timetable | Weekly grid per teacher. Click to add or edit a lesson time. Flags clashes and shows open times |
| Attendance | Every package: lessons used and left, makeups owed, payment, and the lesson log |
| Students | Guardian, phone, registration form, packages and weekly times |
| Setup (super admin) | People and access, studio settings, teachers, Excel export |

## How lessons count

- **Present**, **Makeup lesson** and **No-show** use one lesson from the package.
- **Absent** and **Teacher cancelled** use none and add one makeup owed. Logging a Makeup lesson clears it.

## Access

| Role | Can |
| --- | --- |
| Super admin | Everything: all teachers, students, packages, payments, people and settings |
| Teacher | See their own students, packages and timetable; mark attendance; edit their own timetable |
| Waiting for approval | Nothing. New sign-ups land here until a super admin approves them in Setup → People |

Emails in the `public.app_admins` table become super admin automatically when they sign up. A super admin can promote anyone else in Setup → People.
All rules are enforced in the database with row-level security (`supabase/migrations`).

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm run build
```

`src/config.js` holds the Supabase URL and publishable key (safe to ship; RLS protects the data).
Override with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` if needed.

## Supabase settings to check

In the Supabase dashboard → Authentication → URL Configuration, set **Site URL** to the Vercel address
and add it under **Redirect URLs**, so confirmation and password-reset emails link back to the app.
