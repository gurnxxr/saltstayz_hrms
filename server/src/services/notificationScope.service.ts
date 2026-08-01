import db from '../config/database';
import { Audience } from './notificationEvents';

/**
 * Property → the people responsible for it.
 *
 * `getScope` (manpower.service.ts:39) answers the opposite question — given a user, which
 * properties may they touch — and nothing answered this direction, which is why every notification
 * beyond "tell the approver" had to be a global blast to an entire role. The joins below are
 * deliberately the same ones getScope uses, read backwards, so the two cannot disagree about who
 * owns a property.
 *
 * Two weaknesses are inherited rather than introduced, and both are stated on the settings page:
 *
 *  - property_manager and cluster_hr resolve through `employees.branch_name = properties.name`,
 *    a TEXT match with no foreign key behind it (their own backlog item BN-6). A branch typo
 *    resolves to nobody, which is why an empty resolution logs instead of vanishing.
 *  - hr, finance and admin have no org scoping in this system at all. Asking for them means every
 *    user holding that role, company-wide. That is the honest answer, not a shortcut.
 */

export interface AudienceContext {
  /** The employee the event is about. Absent for system events. */
  employeeId?: number | null;
}

/** Active user ids holding a role. The three unscoped tiers all come through here. */
async function usersWithRole(roleName: string): Promise<number[]> {
  return db('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('r.name', roleName)
    .where('u.is_active', true)
    .pluck('u.id');
}

/** The active login attached to an employee, if they have one. */
async function userForEmployee(employeeId: number): Promise<number[]> {
  const user = await db('users').where({ employee_id: employeeId, is_active: true }).first();
  return user ? [user.id] : [];
}

/**
 * The employee's manager — or HR when they have none.
 *
 * `reporting_manager_id` is ON DELETE SET NULL, so when a manager leaves the company their reports'
 * requests currently notify nobody, forever. The fallback closes that hole. It is stated on the
 * settings page rather than applied invisibly, because "the manager was told" and "HR was told
 * because there is no manager" are different facts.
 */
async function reportingManager(employeeId: number): Promise<number[]> {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp?.reporting_manager_id) return usersWithRole('hr');
  const manager = await userForEmployee(emp.reporting_manager_id);
  // A manager who exists but has no active login is the same hole by another route.
  return manager.length ? manager : usersWithRole('hr');
}

/** Property managers stationed at the same branch as the subject. */
async function propertyManagers(employeeId: number): Promise<number[]> {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp?.branch_name) return [];
  return db('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .join('employees as e', 'e.id', 'u.employee_id')
    .where('r.name', 'property_manager')
    .where('u.is_active', true)
    .whereRaw('lower(e.branch_name) = lower(?)', [emp.branch_name])
    .pluck('u.id');
}

/** Cluster HR assigned to the cluster that owns the subject's property. */
async function clusterHr(employeeId: number): Promise<number[]> {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp?.branch_name) return [];
  return db('user_clusters as uc')
    .join('properties as p', 'p.cluster_id', 'uc.cluster_id')
    .join('users as u', 'u.id', 'uc.user_id')
    .whereRaw('lower(p.name) = lower(?)', [emp.branch_name])
    .where('u.is_active', true)
    .pluck('u.id');
}

/**
 * Resolves one audience to user ids. Returns an empty array rather than throwing when it cannot
 * resolve — the caller dedupes across audiences and logs the empties, so one unresolvable audience
 * never costs the others their notification.
 */
export async function resolveAudience(audience: Audience, ctx: AudienceContext): Promise<number[]> {
  const employeeId = ctx.employeeId ? Number(ctx.employeeId) : null;

  switch (audience) {
    case 'reporting_manager':
      return employeeId ? reportingManager(employeeId) : [];
    case 'property_manager':
      return employeeId ? propertyManagers(employeeId) : [];
    case 'cluster_hr':
      return employeeId ? clusterHr(employeeId) : [];
    case 'hr':
    case 'finance':
    case 'admin':
      return usersWithRole(audience);
    default: {
      // Exhaustiveness: adding an Audience without a branch here fails the build, rather than
      // silently notifying nobody at runtime.
      const unreachable: never = audience;
      return unreachable;
    }
  }
}
