import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/statutory.controller';

// Statutory Components is org-wide payroll setup — Admin & Finance only.
const router = Router();
router.use(authenticate);

const gate = authorizeRoles('admin', 'finance');

router.get('/', gate, ctrl.getStatutory);
router.put('/epf', gate, ctrl.saveEpf);
router.put('/esi', gate, ctrl.saveEsi);
router.put('/bonus', gate, ctrl.saveBonus);
router.put('/pt/:state', gate, ctrl.savePt);
router.put('/lwf/:state', gate, ctrl.saveLwf);
router.post('/minimum-wage', gate, ctrl.addMinimumWage);

export default router;
