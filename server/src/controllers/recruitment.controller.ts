import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as recruitmentService from '../services/recruitment.service';
import { generateJdPdf } from '../services/jdPdf.service';
import { getCtcRange } from '../services/salaryStructure.service';

// ─── Vacancies ───

export async function listVacancies(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status, property_id, department_id, search } = req.query;
    const vacancies = await recruitmentService.listVacancies({
      status: status as string,
      property_id: property_id ? Number(property_id) : undefined,
      department_id: department_id ? Number(department_id) : undefined,
      search: search as string,
    });
    res.json(vacancies);
  } catch (err) {
    next(err);
  }
}

export async function getVacancy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vacancy = await recruitmentService.getVacancy(Number(req.params.id));
    res.json(vacancy);
  } catch (err) {
    next(err);
  }
}

export async function listPostableJobTitles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const titles = await recruitmentService.listPostableJobTitles();
    res.json(titles);
  } catch (err) {
    next(err);
  }
}

export async function createVacancy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vacancy = await recruitmentService.createVacancy({
      ...req.body,
      posted_by: req.user!.userId,
    });
    res.status(201).json(vacancy);
  } catch (err) {
    next(err);
  }
}

export async function updateVacancy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vacancy = await recruitmentService.updateVacancy(Number(req.params.id), req.body);
    res.json(vacancy);
  } catch (err) {
    next(err);
  }
}

export async function deleteVacancy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recruitmentService.deleteVacancy(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function saveVacancyJd(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vacancy = await recruitmentService.updateVacancyJd(Number(req.params.id), req.body);
    res.json(vacancy);
  } catch (err) {
    next(err);
  }
}

export async function downloadVacancyJdPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const vacancy = await recruitmentService.getVacancy(Number(req.params.id));
    const jd = (vacancy.jd_data && typeof vacancy.jd_data === 'object') ? vacancy.jd_data : {};
    // Compensation comes from the salary structure, not the (removed) manual field.
    const range = await getCtcRange(vacancy.job_title_id);
    const buffer = await generateJdPdf({
      jobTitle: vacancy.job_title || 'Position',
      department: vacancy.department_name || '',
      property: vacancy.property_name || '',
      positions: vacancy.positions ?? 1,
      employmentType: jd.employment_type,
      experience: jd.experience,
      salaryRange: range.configured ? `CTC: ${range.label} (indicative)` : undefined,
      reportingTo: jd.reporting_to,
      location: jd.location,
      summary: jd.summary,
      responsibilities: typeof jd.responsibilities === 'string'
        ? jd.responsibilities.split('\n') : (jd.responsibilities || []),
      requirements: typeof jd.requirements === 'string'
        ? jd.requirements.split('\n') : (jd.requirements || []),
      generatedDate: new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
    });

    const filename = `JD_${(vacancy.job_title || 'Position').replace(/\s+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function getVacancyStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const stats = await recruitmentService.getVacancyStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

// ─── Candidates ───

export async function listCandidates(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vacancy_id, stage, search, archived } = req.query;
    const candidates = await recruitmentService.listCandidates({
      vacancy_id: vacancy_id ? Number(vacancy_id) : undefined,
      stage: stage as string,
      search: search as string,
      archived: archived as string,
    });
    res.json(candidates);
  } catch (err) {
    next(err);
  }
}

export async function getCandidate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const candidate = await recruitmentService.getCandidate(Number(req.params.id));
    res.json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function createCandidate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const candidate = await recruitmentService.createCandidate({
      ...req.body,
      added_by: req.user!.userId,
    });
    res.status(201).json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function updateCandidate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const candidate = await recruitmentService.updateCandidate(Number(req.params.id), req.body);
    res.json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function moveCandidateStage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { stage, notes } = req.body;
    const candidate = await recruitmentService.moveCandidateStage(
      Number(req.params.id),
      stage,
      req.user!.userId,
      notes
    );
    res.json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function getCandidateHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const history = await recruitmentService.getCandidateHistory(Number(req.params.id));
    res.json(history);
  } catch (err) {
    next(err);
  }
}

export async function getCandidatesByStage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vacancy_id } = req.query;
    const stats = await recruitmentService.getCandidatesByStage(
      vacancy_id ? Number(vacancy_id) : undefined
    );
    res.json(stats);
  } catch (err) {
    next(err);
  }
}
