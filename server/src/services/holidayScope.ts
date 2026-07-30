import type { Knex } from 'knex';
import db from '../config/database';

/**
 * The one definition of "does this holiday reach this person".
 *
 * Read by the holiday screen (leave.service.getMyHolidays), the attendance calendar
 * (attendance.service.getMyCalendar) and the PAYROLL calendar (payableDays.service
 * .buildWorkCalendar). Change it here and all three move together — that is the whole point.
 * A holiday the screen shows and the payslip ignores (or the reverse) is the failure this
 * function exists to make impossible.
 *
 * It used to be three copies of a two-line WHERE, deliberately, so that an edit made for a
 * screen could not quietly re-price a month. That was the right trade while the rule was small
 * enough to diff by eye. It is now a three-part condition with opt-in semantics, and nobody can
 * verify three copies of that by reading — so the larger risk flipped to the copies drifting.
 *
 * What keeps payroll safe instead: this function is pure query BUILDING. It takes an
 * already-resolved audience and reads no table and no setting of its own. There is nothing in
 * here to make cleverer — acquiring a policy would mean changing the signature, and that changes
 * every call site and shows up in the diff.
 */

/** Everything about a person that decides which holidays reach them. */
export interface HolidayAudience {
  /** The state of the property they work at. Null → only national holidays on this axis. */
  state: string | null;
  /** Resolved properties.id. Null → only `all_properties` holidays can reach them. */
  property_id: number | null;
  /** Resolved departments.id. Null → only `all_departments` holidays can reach them. */
  department_id: number | null;
}

/**
 * Narrow a holidays query to the ones that reach this person. Three axes, AND'd:
 *
 *   region      — national, or the state of the property they work at   (unchanged behaviour)
 *   department  — every department, or one they belong to               (opt-in)
 *   property    — every property, or the one they work at               (opt-in)
 *
 * Opt-in means an UNRESOLVED axis can only ever narrow, never widen: a null `department_id`
 * contributes no OR branch, so a typo in `employees.dept_name` costs that person the targeted
 * holidays rather than handing them everybody's.
 */
export function scopeHolidaysTo<T extends Knex.QueryBuilder>(
  q: T, audience: HolidayAudience, alias: string = 'holidays',
): T {
  const col = (c: string) => `${alias}.${c}`;

  q.where(function () {
    this.where(col('is_national'), true);
    if (audience.state) this.orWhere(col('state'), audience.state);
  });

  q.where(function () {
    this.where(col('all_departments'), true);
    if (audience.department_id !== null) {
      this.orWhereIn(col('id'), db('holiday_departments')
        .select('holiday_id').where('department_id', audience.department_id));
    }
  });

  q.where(function () {
    this.where(col('all_properties'), true);
    if (audience.property_id !== null) {
      this.orWhereIn(col('id'), db('holiday_properties')
        .select('holiday_id').where('property_id', audience.property_id));
    }
  });

  return q;
}

/** The audience inside a resolved scope, so payroll never repeats the lookup. */
export function audienceOf(scope: {
  region: { property_id: number; state: string | null } | null;
  department: { department_id: number } | null;
}): HolidayAudience {
  return {
    state: scope.region?.state ?? null,
    property_id: scope.region?.property_id ?? null,
    department_id: scope.department?.department_id ?? null,
  };
}
