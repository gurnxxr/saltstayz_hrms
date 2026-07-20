import db from '../config/database';

// Sign-in, sign-out, /me and change-password are now handled by Better Auth (mounted at
// /api/v1/auth/*). What remains here is the app's own AUTHORIZATION helper: the permission
// set a role + its per-employee overrides grant, consumed by /session-context and the client.

// A granted per-employee module override confers FULL access to that module in rbac.ts
// (authorize() short-circuits to allow for any action once an allowed override is found — it
// never compares the requested action). So the client-facing permission set must materialise
// EVERY action the module can carry, otherwise can() on the client hides actions the API
// actually permits (notably 'approve' and the org-wide 'read_org'). Keep in lockstep with rbac.ts.
const OVERRIDE_ACTIONS = ['create', 'read', 'update', 'delete', 'approve', 'read_org'];

export async function getUserPermissions(roleId: number, employeeId?: number | null) {
  let perms = await db('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('role_permissions.role_id', roleId)
    .select('permissions.module', 'permissions.action');

  if (employeeId) {
    const overrides = await db('employee_module_access').where('employee_id', employeeId).select('module', 'allowed');
    if (overrides.length) {
      const denied = new Set(overrides.filter((o: any) => !o.allowed).map((o: any) => o.module));
      const granted = overrides.filter((o: any) => o.allowed).map((o: any) => o.module);
      // Remove denied modules entirely
      perms = perms.filter((p: any) => !denied.has(p.module));
      // Add granted modules (full action set) if not already present
      for (const m of granted) {
        for (const a of OVERRIDE_ACTIONS) {
          if (!perms.some((p: any) => p.module === m && p.action === a)) perms.push({ module: m, action: a });
        }
      }
    }
  }
  return perms;
}
