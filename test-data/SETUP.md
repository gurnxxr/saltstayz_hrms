# Loading this dataset

Everything here is **invented**. Names, ID numbers and attendance are fabricated to look plausible;
nothing describes a real person. Employee codes are prefixed `TD-` so they never collide with real
staff and can be deleted in one query afterwards.

Regenerate any time — it is deterministic, so you get the same files back:

```bash
npm run testdata --workspace=server
```

## Do these in the UI first

These have **no CSV upload** and everything below depends on them.

| What | Why | Present in the database this was generated from |
|---|---|---|
| **Job titles** | An unknown Job Title is the one column that **rejects the row outright**. | 11: CHRO · F&B Manager · F&B Server · Finance Executive · Front Desk Executive · Front Office Manager · Housekeeping Attendant · Housekeeping Supervisor · HR Executive · HR Manager · Property Manager |
| **Departments** | An unknown department imports with a warning, but that person then receives **no department-scoped holiday**, which quietly changes their payable days. | 6: Food & Beverage · Front Desk · Housekeeping · Kitchen · Management · Security |
| **Shift types** | Needed before attendance — see the ordering note below. | 4: Evening · General · Morning · Night |
| **Pay grades + property budgets** | Only needed if you want the headcount/budget/band rejections to actually fire. Without them those checks silently pass. | — |
| **One vacancy** | The candidate upload asks which vacancy the applicants are for. | — |
| **The work week** | The default leave template ships with **Saturday *and* Sunday** off. On a 31-day month that throws away 10 of every employee's 31 marks as `off_calendar` and pays everyone a 21-day month. A hotel does not run a five-day week — set it to Sunday only in Leave → Control Panel → Templates, **before** any attendance goes in. | Default template: days 0 and 6 |

**Monthly CTC in the employee file is not the payroll base.** It lands on `employees.monthly_ctc`,
which is the manpower and budget figure. Payroll reads the **salary structure assignment**, and
where an employee has none it falls back to their designation template's default. So until each
person is assigned a structure at their own base, everyone in a designation is paid the same
amount and none of the ESI or EPF boundary rows in `MANIFEST.md` lands on its boundary.

**Statutory rates must exist or every deduction is zero.** `statutory_settings` is created by the
migrations but populated by no seed, so a freshly built environment has EPF, ESI and LWF all at
zero and the state-by-state variation in this dataset is invisible. Run once:

```bash
npm run statutory:ensure --workspace=server
```

## Then upload, in this order

| # | File | Where |
|---|---|---|
| 01 | `01_properties.csv` | Admin → Properties → Upload |
| 02 | `02_employment_types.csv` | Admin → Employment Types → Import |
| 03 | `03_employees.csv` | Employees → Bulk Upload |
| 04 | `04_shift_assignments.csv` | Shifts → Assignments → Bulk Upload |
| 06 | `06a/06b/06c_holidays_*.csv` | Admin → Holidays → Upload — **set the audience per file**, see below |
| 07 | `07_attendance_biometric_week.csv` | Admin → Attendance → daily upload |
| 08–10 | `08/09/10_attendance_grid_*.csv` | Admin → Attendance → marked grid, **month picker set to match the file** |
| 11 | `11_asset_assignments.csv` | Employee Lifecycle → Assets → Bulk Upload |
| 12 | `12_recruitment_candidates.csv` | Recruitment → pick the vacancy → Bulk Upload |

Holiday audience per file — the scope is chosen in the dialog, not in the CSV:

- `06a_holidays_national.csv` → National · every department · every property
- `06b_holidays_delhi.csv` → State = Delhi · every department · Delhi properties only
- `06c_holidays_karnataka.csv` → State = Karnataka · every department · Karnataka properties only

## Four ordering rules that change the data, not just pass/fail

1. **Shift assignments before attendance.** The daily importer reads the shift in force on each date
   to learn that shift's "absent below N hours" and "half day below N hours" thresholds. With no
   shift those are zero, so a short day **can never come out as a half day** — it silently records
   as present. Load attendance first and the half-day test rows are wrong.
2. **Holidays before the attendance grids.** The grid writes nothing for a mark landing on a holiday
   or weekly off, reporting it as `off_calendar`. Load holidays afterwards and it will have
   recorded days it should have ignored.
3. **Nothing locked.** A locked payroll run refuses shift assignments dated at or after its month,
   and makes the grid skip those days entirely.
4. **Leaving dates go in Offboarding, not in the CSV.** The employee uploader has no last-working-day
   column — only `Status`, which flips the active flag on its own. Mark somebody Inactive with no
   leaving date and payroll produces **nothing** for them in any month, including the months they
   actually worked. The two leavers below therefore import as Active; give them their last working
   days in Employee Lifecycle → Offboarding to make the mid-month-leaver cases behave.

## What to check after loading

- **Employees** — 150 rows, spread across 10 properties and 6 states.
- **Attendance** — the grid upload reports `off_calendar` for weekly offs and holidays. That is the
  work calendar winning over the sheet, and it is correct.
- **Payroll** — run May, June and July. Compare the same Delhi employee across all three: they
  should pay Labour Welfare Fund **in June only**. Compare a Karnataka employee: zero in every
  month, because Karnataka has no LWF row at all.
- **MANIFEST.md** lists every deliberately-placed edge case and what it should produce.

## Known limits

- **Gender never imports.** The employee uploader has no column for it, so everyone lands with no
  gender recorded and is excluded from any gender-restricted leave. Not fixed here.
- **No logins are created.** Bulk-imported staff cannot sign in — testing employee self-service
  needs logins made in the admin screen.
- **No commas inside any cell** in the properties, employees, holidays or biometric files. Those
  four parsers split on bare commas. The candidate file does handle quoted commas, and has one.
