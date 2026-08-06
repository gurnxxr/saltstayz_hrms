# What is deliberately in this data

Everything below was placed on purpose. If one of these does not behave as described, that is a
finding — either in the app or in this dataset.

## Boundary cases

| Employee | Set to | What should happen |
|---|---|---|
| `TD-0137` Priya Kumar | unknown property | Branch matches NO property — exercises the Haryana fallback and the state_unresolved flag |
| `TD-0138` Vivaan Joshi | ₹185000/month | High earner — above every ceiling; no ESI, PF capped at ₹15,000 of wage |
| `TD-0139` Karan Pillai | ₹9500/month | Low earner — the minimum-wage flag should fire once state_minimum_wages has rows |
| `TD-0140` Swati Menon | left 2026-07-10 | Left mid-July — set the last working day in Offboarding, then July prorates |
| `TD-0141` Suresh Pillai | left 2026-06-15 | Left mid-June — set the last working day in Offboarding, then June prorates and July produces no payslip |
| `TD-0142` Aadhya Malhotra | joined 2026-07-21 | Joined late July — only a few payable days in July |
| `TD-0143` Pooja Malhotra | joined 2026-06-12 | Joined mid-June — no May payslip at all |
| `TD-0144` Meera Singh | joined 2026-05-16 | Joined mid-May — May pay prorated, June and July full |
| `TD-0145` Ritu Gupta | ₹15001/month | EPF: just over — "if below" components drop out of the PF base |
| `TD-0146` Manish Bansal | ₹15000/month | EPF: exactly ₹15,000 — inclusive, so still "below" |
| `TD-0147` Kabir Gupta | ₹14999/month | EPF: under ₹15,000 — the "if below" components join the PF base |
| `TD-0148` Reyansh Pillai | ₹21001/month | ESI: ₹1 over — should NOT be covered, no ESI line |
| `TD-0149` Nikhil Rao | ₹21000/month | ESI: exactly ₹21,000 — the boundary is INCLUSIVE, so still covered |
| `TD-0150` Amit Rao | ₹20999/month | ESI: just under the ₹21,000 ceiling — should be covered |

## Statutory variation by state

The ten properties sit in six states so that identical people are paid differently:

| State | Properties | Labour Welfare Fund |
|---|---|---|
| Haryana | 2 | percentage of wage, capped at ₹35 — **every month** |
| Delhi | 2 | fixed — **June and December only**, so June differs from May and July |
| Chandigarh | 1 | fixed ₹5 employee / ₹20 employer — every month |
| Uttar Pradesh | 2 | a row exists but is switched off → zero |
| Uttarakhand | 1 | same → zero |
| Karnataka | 2 | **no row at all** → zero, for a different reason |

The clearest single check: take one Delhi employee and one Karnataka employee on similar pay, and
compare their May, June and July payslips. The Delhi one should differ in June. If all six states
produce identical deductions, `statutory_settings` is empty — see SETUP.md.

## Attendance shape

Three months, each generated with its own seed so they are not interchangeable. Roughly 62% present,
with the rest spread across absent, half day, short present, missed punch, no punch and
half-day-with-leave. Every employee has at least two different exception codes, so no row is a
featureless run of P.

The summary columns in each grid are recomputed from that row's own cells, so they always agree
with the day-by-day marks. The importer ignores them; a person reading the file does not.
