import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/employeeLifecycle.controller';

// Employee Lifecycle (Promotion / Transfer / Exit Interview) — HR-side module.
//
// Gated on the `employee_lifecycle` module rather than a hard-coded role list, so the
// Admin → Module Access toggle for this module governs the API and not just the sidebar.
// The swap is access-neutral: `employee_lifecycle:read` is granted to exactly admin,
// chro, hr and hr_manager — the same four the old authorizeRoles() list allowed.
//
// `read` is the only action minted for this module (see seed 01 / archived migration 077),
// so every endpoint here checks 'read'. Do not reach for 'create'/'update' actions that
// do not exist — authorize() would reject everyone. Write-side narrowing is done with the
// ADMIN_ONLY role gate below.
const router = Router();
router.use(authenticate);

router.use(authorize('employee_lifecycle', 'read'));

// Item catalog + assignment deletions are corrective, admin-only actions.
const ADMIN_ONLY = authorizeRoles('admin');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (/\.csv$/i.test(file.originalname) || ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Please upload a .csv file'));
  },
});
function uploadCsv(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'CSV file is too large (max 5 MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

router.get('/options', ctrl.getOptions);
router.get('/employees', ctrl.listEmployees);

router.get('/promotions', ctrl.listPromotions);
router.post('/promotions', ctrl.createPromotion);

router.get('/transfers', ctrl.listTransfers);
router.post('/transfers', ctrl.createTransfer);

router.get('/exit-interviews', ctrl.listExitInterviews);
router.post('/exit-interviews', ctrl.scheduleExitInterview);
router.put('/exit-interviews/:id/complete', ctrl.completeExitInterview);

// ─── Company Assets ───
router.get('/assets/types', ctrl.listAssetTypes);
router.post('/assets/types', ADMIN_ONLY, ctrl.createAssetType);
router.put('/assets/types/:id', ADMIN_ONLY, ctrl.updateAssetType);

router.get('/assets/assignments', ctrl.listAssignments);
router.post('/assets/assignments/bulk-upload', uploadCsv, ctrl.bulkUploadAssignments);
router.post('/assets/assignments', ctrl.createAssignment);
router.put('/assets/assignments/:id', ctrl.updateAssignment);
router.put('/assets/assignments/:id/return', ctrl.returnAssignment);
router.delete('/assets/assignments/:id', ADMIN_ONLY, ctrl.deleteAssignment);

router.get('/assets/outstanding/:employeeId', ctrl.getOutstandingAssets);

export default router;
