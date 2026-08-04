# SaltStayz HRMS — Sample Upload Data (manual functional testing)

Ready-to-upload CSVs for **every place in the app that accepts a CSV**. Each file matches the exact
columns that uploader expects, references **real seeded data** (employee codes `PD-0001…`,
properties, shifts) so rows actually import, and now includes **deliberate edge cases** — missing
fields, cap rejections, duplicates, bad dates, unknown references — so you can exercise every code
path, not just the happy one.

> Log in as **admin** before uploading. All uploads are permission-gated. After an upload, read the
> result toast / summary — most importers report `created / updated / skipped` plus per-row errors.

## What to upload where

| # | File | Where in the app | Notes |
|---|------|------------------|-------|
| 1 | `01_employees.csv` | **Employees** (or Employee Lifecycle) → **Bulk Upload** | New staff + Monthly CTC (salary). Cap-enforced. |
| 2 | `02_properties.csv` | **Admin → Organization → Properties → Upload CSV** | Reads Name, Hotel ID, City, **State**, Address, Category. State is required — it decides Professional Tax, Labour Welfare Fund and minimum wage for everyone at that property. |
| 3 | `03_attendance.csv` | **Admin → Attendance → Upload** | Biometric-style: `DD-MM-YYYY` dates, `HH:MM` times, dates in an unlocked month (Jul 2026). |
| 4 | `04_shift_assignments.csv` | **Shifts → Assignments → Bulk Upload** | `Shift` = General / Morning / Evening / Night. |
| 5 | `05_holidays.csv` | **Leaves → Holidays → Upload CSV** | Pick the **scope** (National or a state) in the dialog. Replaces that scope. |
| 6 | `06_recruitment_candidates.csv` | **Recruitment →** a vacancy **→ Bulk Upload** | You pick the **vacancy** in the UI. |
| 7 | `07_employment_types.csv` | **Admin → Employment Types → Import CSV** | Existing types are matched by name and updated. |
| 8 | `08_asset_assignments.csv` | **Employee Lifecycle → Assets → Bulk Upload** | Asset issuances. |

## Edge cases each file exercises

**01_employees.csv** (9 rows) — new hires across all 3 properties/departments; `PD-9004` with blank
email/father/aadhaar/PAN/manager (optional fields); `PD-9005` with **blank Monthly CTC** (imports but
shows as "missing salary"); `PD-9006` a Housekeeping Attendant at **₹50,000** → **rejected: over the
role's sanctioned band** (cap test); `PD-9007` at branch "SaltStayz Pune" which isn't a real property
→ cap gate is skipped, row imports; `PD-9008` **Status = Inactive**; genders Male/Female/Other; and a
final row with a **blank Employee Code** → reported as a row error.

**02_properties.csv** (5 rows) — three full properties; "SaltStayz Kochi" with only Name+City (minimal);
and **"SaltStayz Gurgaon" which duplicates an existing property name** (tests duplicate-name handling).

**03_attendance.csv** (10 rows) — full day, **late arrival** (`PD-0001` 10:45), **half-day** short hours
(`PD-0002` 09:30–13:30), **miss-punch** with only in-time and another with only out-time, a punch at
**Connaught Place** (cross-location), an explicit **`HHD`** half-day-holiday with no punches, a
**duplicate** employee+date row (unique/upsert), and an **invalid date** `99-99-2026` → row error.

**04_shift_assignments.csv** (10 rows) — one per shift type; `PD-0001` gets **two dated assignments**
(Aug + Sep); plus error rows: **unknown shift** "Graveyard", **unknown employee** `PD-9999`, a
**bad date format** `01-08-2026`, and a **blank shift**.

**05_holidays.csv** (9 rows) — seven valid holidays, plus a row **missing the date** and a row
**missing the name** (both silently skipped).

**06_recruitment_candidates.csv** (7 rows) — full rows with quoted addresses (commas); one **missing
email** (dedup by phone); one **missing phone** (dedup by email); one with **only a name**; an exact
**duplicate** (skipped); and a row **missing the name** → error.

**07_employment_types.csv** (7 rows) — new types with/without prefix & restrictions; **"Probation"**
and **"Confirmed"** which **update existing seeded types** by name; `Y` vs `N` confirmed; a restriction
naming an **unknown type** "UnknownType" → reported; and a row **missing the name** → error.

**08_asset_assignments.csv** (7 rows) — different items/serials; one with **no serial** (optional); a
**`DD/MM/YYYY`** date to test date tolerance; a **`returned`** status; an **unknown employee** `PD-9999`;
and a row **missing the Item** → error.

## Salary / financial data

There is **no standalone salary-upload CSV**. An employee's salary is the **Monthly CTC** column in
`01_employees.csv` (or set per-employee in **Payroll → Salary Setup**). Salary *structures* and *bank
details* are UI-only.

## Created in the UI only (no CSV)

Vacancies, salary structures, bank details, leave templates/entitlements, and single
departments/job-titles are added through their screens.

## Monthly attendance grid — `attendance-grid-YYYY-MM.csv`

A whole month of attendance for every employee, in the layout the biometric dashboard exports:
one row per person, one column per day. Uploaded at **Admin → Attendance** (a different screen from
the daily biometric import), with the month picker set to the **same month as the file**.

Generated, not hand-written — re-run it for any month:

```bash
npm run attendance:grid --workspace=server -- --month=2026-08
```

The generator (`server/src/db/generate-attendance-grid.ts`) is deterministic, so the same month
always produces the same sheet. It covers every employee code the repo knows about: the active roster
in whichever database it is pointed at, plus the codes in `db/import-csv.ts`. Codes the target
environment does not recognise are reported back as `unmatched` and skipped — harmless — so one file
can be uploaded to more than one environment.

**The attendance itself is invented.** It is shaped to look plausible (~62% present, with a tail of
absences, half days, short and missed punches) so that payroll, reports and the coverage gate have
realistic volume to chew on. It is not a record of anything that happened.

Two things that surprise people on first upload:

- Marks landing on someone's **weekly off or a company holiday write nothing** and are counted as
  `off_calendar`. The work calendar wins over the sheet — by design.
- Days in a **locked payroll month** are skipped and listed under `locked_months`.

Codes: `P` present · `A` absent · `HD` half day · `SP` short present · `MP` missed punch ·
`NP` no punch · `HHD` half-day-with-leave. The seven summary columns are for humans — the importer
ignores them — but they are generated from the row's own cells, so they always agree with it.

## Format tips

- Files **1, 2, 3, 5** are parsed by a simple comma split — **no commas inside a field** there.
- Files **4, 6, 7, 8** use a full CSV parser, so quoted commas are fine (see the quoted addresses and
  the `"Contract, Trainee"` restriction).
- Re-uploading is generally safe: employees/employment-types update by key, candidates skip
  duplicates, holidays replace the chosen scope.
