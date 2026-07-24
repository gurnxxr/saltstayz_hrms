import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/statutory.controller';

// Statutory Components is org-wide payroll setup — Admin & Finance only.
const router = Router();
router.use(authenticate);

const gate = authorizeRoles('admin', 'finance');

router.get('/', gate, ctrl.getStatutory);
// Resolved rates (read-only, no org identifiers) — also needed by the
// salary-structure preview, which CHRO/HR can open.
router.get('/rates', authorizeRoles('admin', 'chro', 'hr', 'finance'), ctrl.getRates);
// Operating states for the salary-structure preview picker (same audience as /rates).
router.get('/states', authorizeRoles('admin', 'chro', 'hr', 'finance'), ctrl.listStates);
router.put('/epf', gate, ctrl.saveEpf);
router.put('/esi', gate, ctrl.saveEsi);
router.put('/bonus', gate, ctrl.saveBonus);
router.put('/pt/:state', gate, ctrl.savePt);
router.put('/lwf/:state', gate, ctrl.saveLwf);
router.post('/minimum-wage', gate, ctrl.addMinimumWage);

export default router;
