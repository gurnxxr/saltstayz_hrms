import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/statutory.controller';

// Statutory Components is org-wide payroll setup — Admin & Finance only.
const router = Router();
router.use(authenticate);

// Belt and braces, same as payroll.routes.ts: the role gate says WHO may reach payroll
// setup, and `payroll_setup` lets Admin → Module Access revoke it from an individual.
// Both must pass, so pairing them can only ever narrow access, never widen it.
const gate = authorizeRoles('admin', 'finance');

router.get('/', authorize('payroll_setup', 'read'), gate, ctrl.getStatutory);
// Resolved rates (read-only, no org identifiers) — also needed by the
// salary-structure preview, which CHRO/HR can open.
//
// NOT paired with authorize('payroll_setup', …): this endpoint's audience is wider than
// the module's grant list (chro and hr deliberately hold no payroll_setup permission),
// so adding the module check here would REVOKE access from chro and hr. Left role-gated.
router.get('/rates', authorizeRoles('admin', 'chro', 'hr', 'finance'), ctrl.getRates);
// Operating states for the salary-structure preview picker (same audience as /rates —
// and same reason for not pairing it with the payroll_setup module check).
router.get('/states', authorizeRoles('admin', 'chro', 'hr', 'finance'), ctrl.listStates);
router.put('/epf', authorize('payroll_setup', 'update'), gate, ctrl.saveEpf);
router.put('/esi', authorize('payroll_setup', 'update'), gate, ctrl.saveEsi);
router.put('/bonus', authorize('payroll_setup', 'update'), gate, ctrl.saveBonus);
router.put('/pt/:state', authorize('payroll_setup', 'update'), gate, ctrl.savePt);
router.put('/lwf/:state', authorize('payroll_setup', 'update'), gate, ctrl.saveLwf);
router.post('/minimum-wage', authorize('payroll_setup', 'update'), gate, ctrl.addMinimumWage);

export default router;
