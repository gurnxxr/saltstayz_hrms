# Shift Management rework — how to roll it out

Off days used to come from a weekly roster grid. They now come from the shift an employee is
mapped to. That changes how payable days are counted, which changes pay — so **the order below
matters**, and two of the steps can only be done while the old roster data still exists.

The hard rule: **no month that has already been paid may change.**

---

## Before anything ships

### 1. Deploy the freeze, on its own

```bash
npm run db:migrate --workspace=server     # runs 002_freeze_paid_months
```

This changes no behaviour. It marks every payslip from a month **before the current one** as
"calculated under the old rules", and from then on those are always served from their saved
copy — locked or not. Re-running, regenerating or correcting one is refused.

The month in progress is deliberately left alone. Freezing is one-way, and previewing a draft
of the current month is normal — freezing that draft would leave the month impossible to re-run
or correct while still being lockable and payable at whatever partial figures the preview held.
The migration prints exactly which periods it froze; check that list against what you expect.

The refusal is scoped to the **month**, not to one person's payslip. Someone skipped by the
original run has no saved payslip of their own, but writing a fresh one for them would still
move that month's headline totals, because those are re-aggregated across every payslip in the
period.

Do this **first**, and let it settle, before deploying anything else.

### 2. Capture the baseline — while the roster still has data

```bash
npm run baseline:capture --workspace=server
```

Read-only. Writes to `server/data/shift-rework-baseline/` (gitignored — it contains employee
names, so don't commit or email it).

Three things come out, and **two of them cannot be recovered later**:

- `payslips.json` — every figure of every payslip ever issued. This is what step 5 checks against.
- `roster-provenance.json` — which months actually followed a published roster. Payroll works
  this out on every run but never stores it.
- `weekly-patterns.json` — each employee's observed off days and usual shift.

> Take a copy of this directory somewhere safe. If it is lost, there is nothing to prove the
> rework against.

---

## Rolling out

### 3. Deploy the rest, then work out the off-day patterns

```bash
npm run db:migrate --workspace=server     # 003, 004, 005
npm run patterns:report --workspace=server
```

`patterns:report` reads the roster and works out what each shift's off days should be. **It only
reports** — nothing changes until you add `--apply`.

Read the output properly. It proposes a pattern only where every employee on a shift was
rostered the same way. Where they disagree, or where somebody's Saturdays were genuinely
inconsistent, it says so and proposes nothing — that needs a decision about whether to split the
shift or standardise it, and a guess would land in somebody's salary.

```bash
npm run patterns:report --workspace=server -- --apply
```

### 4. Fill the gaps by hand

- **Shift Management → Shift Types**: set each shift's absent / half-day / full-day hours. Until
  these are set, attendance keeps whatever the upload decided — deliberately, so an unconfigured
  shift never marks everyone present.
- **Shift Management → Shift Assignments**: anyone showing "No shift" needs one. A shift with no
  off-day pattern falls back to the company Monday-to-Friday week, which is probably wrong for
  hospitality staff.

---

## Proving it

### 5. Check that nothing paid has moved

```bash
npm run baseline:verify --workspace=server
```

Compares every figure of every historical payslip against the baseline, to the rupee, with no
tolerance. Four comparisons, because they fail independently:

- **Saved** — the row in the database. Catches anything that rewrote history.
- **Served** — what the app hands back. Catches a read path that recomputes instead of serving
  the frozen copy.
- **Appeared** — a payslip in a paid month that the baseline never had. Walking the baseline
  alone can only notice rows that changed or vanished; an inserted one is invisible that way,
  and it still moves the month's totals.
- **Run totals** — `status`, `employee_count`, `total_net` and `total_ctc` per month. These are
  an aggregate, so they can move while every individual payslip stays byte-identical.

**Any difference is a stop-the-line failure.** Don't widen a tolerance; find out what moved.

```bash
npm run baseline:verify --workspace=server -- --shadow
```

Also recomputes each month under the new rules and shows how far it *would* have drifted. Those
differences are expected and are the point — they show the freeze is doing real work rather than
the two calendars happening to agree. An empty shadow list means the check is untested, not that
it passed.

Note that a month where nobody lost any pay can shift its working-day count without the money
changing: with no deductions, the proration ratio stays 1 however many working days there are.
Months **with** absences are where money moves.

---

## What to keep an eye on afterwards

**The first payroll run after this.** Compare it against the previous month before locking it —
the working-day count is the number to look at.

**Migration 006 drops the roster and the biometric tables.** The biometric ones go without
ceremony — the code that used them is gone and nothing can write to them.

The roster is different, and 006 guards it. `shift_rosters` is the only record of why a past
month treated a given day as an off day; the payslip snapshot does not store that, and
`patterns:report` reads the roster to work out each shift's off days. So if the roster still
holds rows and no shift has a pattern set, 006 **refuses to run** and tells you to derive the
patterns first. Once at least one shift has a pattern, the roster's job is done and it goes.

Its `down()` recreates the table shapes so the schema lines up again, but **not** their
contents. Once 006 has run forward, the only way back to the data is a database backup.

**Two shift fields are inert.** "Monthly adjustment" and "force time out" are stored and shown
but deliberately do not affect pay, because their meaning was never confirmed. They are labelled
as such in the form.

---

## If it goes wrong

Every migration has a `down()`. Roll back in reverse order (005 → 002).

Rolling back **004** collapses each employee's dated assignments to the most recent one, which
loses the history of when they moved shift. Rolling back **003** restores the dropped shift
columns but not their old values.

The freeze itself is the safety net: as long as 002 has run, a paid month is served from its
saved copy no matter what the rest of the code does.
