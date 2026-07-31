import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/recruitment.controller';

const router = Router();
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // accept=".csv" on the client is advisory; reject a non-CSV (e.g. an .xlsx) here too.
    if (/\.csv$/i.test(file.originalname) || ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Please upload a .csv file'));
  },
});

// Run multer but turn its size/type rejections into a clean 400 — otherwise a bare
// MulterError falls through to the global handler as a generic 500.
function uploadCsv(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'CSV file is too large (max 5 MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

// Stage vocabulary (steps 3-11) — the client mirrors this, it does not decide.
router.get('/stages', authorize('recruitment', 'read'), ctrl.getStages);

// Vacancy stats
router.get('/stats', authorize('recruitment', 'read'), ctrl.getVacancyStats);
router.get('/candidates/by-stage', authorize('recruitment', 'read'), ctrl.getCandidatesByStage);

// Postable job titles (with salary-structure status) for the new-vacancy form
router.get('/job-titles', authorize('recruitment', 'read'), ctrl.listPostableJobTitles);

// Steps 9-11: joining queue
router.get('/joining-queue', authorize('recruitment', 'read'), ctrl.getJoiningQueue);

// Vacancies (steps 1-2)
router.get('/vacancies', authorize('recruitment', 'read'), ctrl.listVacancies);
router.get('/vacancies/:id', authorize('recruitment', 'read'), ctrl.getVacancy);
router.post('/vacancies', authorize('recruitment', 'create'), ctrl.createVacancy);
router.put('/vacancies/:id', authorize('recruitment', 'update'), ctrl.updateVacancy);
router.delete('/vacancies/:id', authorize('recruitment', 'delete'), ctrl.deleteVacancy);
router.put('/vacancies/:id/jd', authorize('recruitment', 'update'), ctrl.saveVacancyJd);
router.get('/vacancies/:id/jd/pdf', authorize('recruitment', 'read'), ctrl.downloadVacancyJdPdf);

// Candidates (steps 3-11)
router.get('/candidates', authorize('recruitment', 'read'), ctrl.listCandidates);
router.get('/candidates/:id', authorize('recruitment', 'read'), ctrl.getCandidate);
router.post('/candidates', authorize('recruitment', 'create'), ctrl.createCandidate);
router.post('/candidates/bulk-upload', authorize('recruitment', 'create'), upload.single('file'), ctrl.bulkUploadCandidates);
router.put('/candidates/:id', authorize('recruitment', 'update'), ctrl.updateCandidate);
router.put('/candidates/:id/stage', authorize('recruitment', 'update'), ctrl.moveCandidateStage);
router.put('/candidates/:id/hold', authorize('recruitment', 'update'), ctrl.setCandidateHold);
router.get('/candidates/:id/history', authorize('recruitment', 'read'), ctrl.getCandidateHistory);
router.get('/candidates/:id/checklists', authorize('recruitment', 'read'), ctrl.getCandidateChecklists);

// Offer lifecycle (steps 7-8)
router.get('/salary-components', authorize('recruitment', 'read'), ctrl.listOfferComponents);
router.get('/candidates/:id/offer-defaults', authorize('recruitment', 'read'), ctrl.getOfferDefaults);
router.get('/candidates/:id/offer-breakdown', authorize('recruitment', 'read'), ctrl.getOfferBreakdown);
// POST too: the offer's draft structure lines don't fit in a query string.
router.post('/candidates/:id/offer-breakdown', authorize('recruitment', 'read'), ctrl.getOfferBreakdown);
router.post('/candidates/:id/offer/preview', authorize('recruitment', 'create'), ctrl.previewOffer);
router.get('/candidates/:id/offer/pdf', authorize('recruitment', 'read'), ctrl.downloadOfferPdf);
router.post('/candidates/:id/offer/accept', authorize('recruitment', 'create'), ctrl.acceptOffer);
router.post('/candidates/:id/offer/decline', authorize('recruitment', 'update'), ctrl.declineOffer);
router.post('/candidates/:id/offer', authorize('recruitment', 'create'), ctrl.releaseOffer);
// When release is blocked by the sanctioned cap, HR raises an admin-approval request instead of being dead-ended.
router.post('/candidates/:id/offer/request-approval', authorize('recruitment', 'create'), ctrl.requestOfferApproval);
router.get('/candidates/:id/offer', authorize('recruitment', 'read'), ctrl.getOffer);

// Step 11: transfer to reporting manager
router.post('/candidates/:id/transfer', authorize('recruitment', 'update'), ctrl.transferToManager);

export default router;
