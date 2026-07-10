import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as recruitmentService from '../services/recruitment.service';
import * as checklistService from '../services/checklist.service';
import { generateJdPdf } from '../services/jdPdf.service';
import { generateOfferLetterPdf } from '../services/offerLetterPdf.service';
import { getCtcRange } from '../services/salaryStructure.service';

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

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

// ─── Stage vocabulary (server is authoritative; the client mirrors it) ───

export function getStages(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      funnel_order: recruitmentService.FUNNEL_ORDER,
      off_ramps: recruitmentService.OFF_RAMPS,
      labels: recruitmentService.STAGE_LABELS,
      stage_checklist: recruitmentService.STAGE_CHECKLIST,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Candidate checklists (steps 6, 9, 10) ───

export async function getCandidateChecklists(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.listForSubject({ candidate_id: Number(req.params.id) }));
  } catch (err) {
    next(err);
  }
}

// ─── Offer lifecycle (steps 7-8) ───

export async function getOfferDefaults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recruitmentService.getOfferDefaults(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

/** Draft lines are too big for a query string, so the editor POSTs them; GET ?base= still works. */
export async function getOfferBreakdown(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const base = req.body?.base_gross != null ? Number(req.body.base_gross)
      : (req.query.base != null ? Number(req.query.base) : 0);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
    res.json(await recruitmentService.getOfferBreakdown(Number(req.params.id), base, lines));
  } catch (err) {
    next(err);
  }
}

/** The salary-component catalog the offer's line editor picks from. */
export async function listOfferComponents(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await recruitmentService.listOfferComponents()); } catch (err) { next(err); }
}

export async function previewOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { candidate, template_data } = await recruitmentService.previewOffer(Number(req.params.id), {
      base_gross: Number(req.body.base_gross) || 0,
      joining_date: req.body.joining_date,
      designation: req.body.designation,
      lines: Array.isArray(req.body.lines) ? req.body.lines : null,
    });
    const buffer = await generateOfferLetterPdf({
      candidateName: candidate.name,
      designation: template_data.designation,
      salary: template_data.salary,
      joiningDate: fmtDate(template_data.joining_date),
      employeeCode: '—',
      generatedBy: req.user!.email,
      generatedDate: fmtDate(new Date().toISOString()),
      salaryBreakdown: template_data.breakdown,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="offer-preview.pdf"');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function releaseOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const candidate = await recruitmentService.releaseOffer(
      Number(req.params.id),
      {
        base_gross: Number(req.body.base_gross) || 0,
        joining_date: req.body.joining_date,
        designation: req.body.designation,
        lines: Array.isArray(req.body.lines) ? req.body.lines : null,
      },
      req.user!.userId
    );
    res.status(201).json(candidate);
  } catch (err) {
    next(err);
  }
}

export async function getOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recruitmentService.getOfferLetter(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function downloadOfferPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const letter = await recruitmentService.getOfferLetter(Number(req.params.id));
    const tpl = letter.template_data || {};
    const buffer = await generateOfferLetterPdf({
      candidateName: letter.candidate_name,
      designation: tpl.designation || '—',
      salary: tpl.salary || '—',
      joiningDate: fmtDate(tpl.joining_date),
      employeeCode: '—',
      generatedBy: req.user!.email,
      generatedDate: fmtDate(letter.created_at),
      salaryBreakdown: tpl.breakdown,
    });
    const filename = `Offer_Letter_${String(letter.candidate_name || 'Candidate').replace(/\s+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function acceptOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recruitmentService.acceptOffer(Number(req.params.id), req.user!.userId, req.body.joining_date));
  } catch (err) {
    next(err);
  }
}

export async function declineOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recruitmentService.declineOffer(Number(req.params.id), req.user!.userId, req.body.reason));
  } catch (err) {
    next(err);
  }
}

// ─── Step 11: transfer to reporting manager ───

export async function transferToManager(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recruitmentService.transferToManager(Number(req.params.id), req.user!.userId, req.body.notes));
  } catch (err) {
    next(err);
  }
}

// ─── Steps 9-11: joining queue ───

export async function getJoiningQueue(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await recruitmentService.listJoiningQueue());
  } catch (err) {
    next(err);
  }
}
