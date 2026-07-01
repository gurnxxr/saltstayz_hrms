import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/recruitment.controller';

const router = Router();
router.use(authenticate);

// Vacancy stats
router.get('/stats', authorize('recruitment', 'read'), ctrl.getVacancyStats);
router.get('/candidates/by-stage', authorize('recruitment', 'read'), ctrl.getCandidatesByStage);

// Postable job titles (with salary-structure status) for the new-vacancy form
router.get('/job-titles', authorize('recruitment', 'read'), ctrl.listPostableJobTitles);

// Vacancies
router.get('/vacancies', authorize('recruitment', 'read'), ctrl.listVacancies);
router.get('/vacancies/:id', authorize('recruitment', 'read'), ctrl.getVacancy);
router.post('/vacancies', authorize('recruitment', 'create'), ctrl.createVacancy);
router.put('/vacancies/:id', authorize('recruitment', 'update'), ctrl.updateVacancy);
router.delete('/vacancies/:id', authorize('recruitment', 'delete'), ctrl.deleteVacancy);
router.put('/vacancies/:id/jd', authorize('recruitment', 'update'), ctrl.saveVacancyJd);
router.get('/vacancies/:id/jd/pdf', authorize('recruitment', 'read'), ctrl.downloadVacancyJdPdf);

// Candidates
router.get('/candidates', authorize('recruitment', 'read'), ctrl.listCandidates);
router.get('/candidates/:id', authorize('recruitment', 'read'), ctrl.getCandidate);
router.post('/candidates', authorize('recruitment', 'create'), ctrl.createCandidate);
router.put('/candidates/:id', authorize('recruitment', 'update'), ctrl.updateCandidate);
router.put('/candidates/:id/stage', authorize('recruitment', 'update'), ctrl.moveCandidateStage);
router.get('/candidates/:id/history', authorize('recruitment', 'read'), ctrl.getCandidateHistory);

export default router;
