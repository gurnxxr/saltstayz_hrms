import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/onboarding.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

// Stats
router.get('/stats', authorize('onboarding', 'read'), ctrl.getStats);

// Offer flow (candidate-centric until acceptance)
router.get('/offer-candidates', authorize('onboarding', 'read'), ctrl.listOfferCandidates);
router.post('/offer-candidates/:candidateId/offer', authorize('onboarding', 'create'), ctrl.generateCandidateOffer);
router.get('/offer-candidates/:candidateId/pdf', authorize('onboarding', 'read'), ctrl.downloadCandidateOfferPdf);
router.post('/offer-candidates/:candidateId/accept', authorize('onboarding', 'create'), ctrl.acceptCandidateOffer);
router.post('/offer-candidates/:candidateId/decline', authorize('onboarding', 'update'), ctrl.declineCandidateOffer);

// Checklists
router.get('/checklists', authorize('onboarding', 'read'), ctrl.listChecklists);
router.get('/checklists/:id', authorize('onboarding', 'read'), ctrl.getChecklist);
router.post('/checklists', authorize('onboarding', 'create'), ctrl.createChecklist);
router.put('/checklists/:id/status', authorize('onboarding', 'update'), ctrl.updateStatus);
router.post('/checklists/:id/items', authorize('onboarding', 'update'), ctrl.addItem);
router.put('/items/:itemId/toggle', authorize('onboarding', 'update'), ctrl.toggleItem);
router.delete('/items/:itemId', authorize('onboarding', 'delete'), ctrl.deleteItem);

// Per-item document upload / download / remove
router.post('/items/:itemId/document', authorize('onboarding', 'update'), upload.single('file'), ctrl.uploadItemDocument);
router.get('/items/:itemId/document', authorize('onboarding', 'read'), ctrl.downloadItemDocument);
router.delete('/items/:itemId/document', authorize('onboarding', 'update'), ctrl.removeItemDocument);

// Offer letter issued after onboarding completes
router.get('/offer-ready', authorize('onboarding', 'read'), ctrl.listOfferReady);
router.get('/employees/:employeeId/offer-defaults', authorize('onboarding', 'read'), ctrl.getOfferDefaults);
router.get('/employees/:employeeId/offer-breakdown', authorize('onboarding', 'read'), ctrl.getOfferBreakdown);
router.post('/employees/:employeeId/offer-letter/preview', authorize('onboarding', 'create'), ctrl.previewEmployeeOfferLetter);
router.post('/employees/:employeeId/offer-letter', authorize('onboarding', 'create'), ctrl.generateEmployeeOfferLetter);

// Offer Letters
router.get('/offer-letters', authorize('onboarding', 'read'), ctrl.listOfferLetters);
router.get('/offer-letters/:id', authorize('onboarding', 'read'), ctrl.getOfferLetter);
router.get('/offer-letters/:id/pdf', authorize('onboarding', 'read'), ctrl.downloadOfferLetterPdf);
router.post('/offer-letters', authorize('onboarding', 'create'), ctrl.createOfferLetter);
router.post('/offer-letters/preview-pdf', authorize('onboarding', 'create'), ctrl.previewOfferLetterPdf);

export default router;
