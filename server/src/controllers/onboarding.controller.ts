import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as onboardingService from '../services/onboarding.service';
import { generateOfferLetterPdf } from '../services/offerLetterPdf.service';
import { getStructureByJobTitle, computeForStructure } from '../services/salaryStructure.service';

export async function listChecklists(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.listChecklists({
      status: req.query.status as string,
      search: req.query.search as string,
    }));
  } catch (err) { next(err); }
}

export async function getChecklist(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.getChecklist(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function createChecklist(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await onboardingService.createChecklist(Number(req.body.employee_id)));
  } catch (err) { next(err); }
}

export async function addItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await onboardingService.addChecklistItem(
      Number(req.params.id),
      req.body.item_name
    ));
  } catch (err) { next(err); }
}

export async function toggleItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.toggleItem(Number(req.params.itemId), req.user!.userId));
  } catch (err) { next(err); }
}

export async function deleteItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await onboardingService.deleteItem(Number(req.params.itemId));
    res.json({ message: 'Item removed' });
  } catch (err) { next(err); }
}

export async function updateStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.updateChecklistStatus(Number(req.params.id), req.body.status));
  } catch (err) { next(err); }
}

export async function getStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.getOnboardingStats());
  } catch (err) { next(err); }
}

// Offer Letters
export async function listOfferLetters(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.listOfferLetters());
  } catch (err) { next(err); }
}

export async function createOfferLetter(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await onboardingService.createOfferLetter(
      Number(req.body.employee_id),
      req.body.template_data,
      req.user!.userId
    ));
  } catch (err) { next(err); }
}

export async function getOfferLetter(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.getOfferLetter(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function downloadOfferLetterPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const letter = await onboardingService.getOfferLetter(Number(req.params.id));
    const tpl = letter.template_data || {};
    const joiningDate = tpl.joining_date
      ? new Date(tpl.joining_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';
    const generatedDate = new Date(letter.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

    // Prefer the breakdown snapshot stored when the offer was issued (reflects any
    // base-salary adjustment); fall back to the live structure for legacy letters.
    let salaryBreakdown = tpl.breakdown;
    if (!salaryBreakdown && letter.job_title_id) {
      const struct = await getStructureByJobTitle(letter.job_title_id);
      if (struct) salaryBreakdown = await computeForStructure(struct, Number(struct.default_base) || 0);
    }

    const pdfBuffer = await generateOfferLetterPdf({
      candidateName: `${letter.first_name} ${letter.last_name}`,
      designation: tpl.designation || '—',
      salary: tpl.salary || '—',
      joiningDate,
      employeeCode: letter.employee_code || '—',
      generatedBy: letter.generated_by_email,
      generatedDate,
      salaryBreakdown,
    });

    const filename = `Offer_Letter_${letter.first_name}_${letter.last_name}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
}

// ─── Offer flow (candidate-centric) ───

export async function listOfferCandidates(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.listOfferCandidates());
  } catch (err) { next(err); }
}

export async function generateCandidateOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.generateCandidateOffer(
      Number(req.params.candidateId),
      { joining_date: req.body.joining_date },
      req.user!.userId
    ));
  } catch (err) { next(err); }
}

export async function downloadCandidateOfferPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { buffer, candidateName } = await onboardingService.downloadCandidateOfferPdf(Number(req.params.candidateId));
    const filename = `Offer_Letter_${candidateName.replace(/\s+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) { next(err); }
}

export async function acceptCandidateOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await onboardingService.acceptCandidateOffer(Number(req.params.candidateId), req.user!.userId));
  } catch (err) { next(err); }
}

export async function declineCandidateOffer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.declineCandidateOffer(Number(req.params.candidateId), req.user!.userId));
  } catch (err) { next(err); }
}

// ─── Offer letter issued after onboarding completes ───

export async function listOfferReady(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.listOfferReadyEmployees());
  } catch (err) { next(err); }
}

export async function getOfferDefaults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.getOfferDefaults(Number(req.params.employeeId)));
  } catch (err) { next(err); }
}

/** Live server-computed offer breakdown at an adjusted base (editor preview). */
export async function getOfferBreakdown(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const base = req.query.base != null ? Number(req.query.base) : undefined;
    res.json(await onboardingService.getEmployeeOfferBreakdown(Number(req.params.employeeId), base));
  } catch (err) { next(err); }
}

export async function previewEmployeeOfferLetter(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const buffer = await onboardingService.previewOfferLetterForEmployee(Number(req.params.employeeId), {
      base_gross: req.body.base_gross != null ? Number(req.body.base_gross) : undefined,
      designation: req.body.designation,
      joining_date: req.body.joining_date,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="offer-preview.pdf"');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) { next(err); }
}

export async function generateEmployeeOfferLetter(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await onboardingService.generateOfferLetterForEmployee(
      Number(req.params.employeeId),
      req.user!.userId,
      {
        base_gross: req.body.base_gross != null ? Number(req.body.base_gross) : undefined,
        designation: req.body.designation,
        joining_date: req.body.joining_date,
      }
    ));
  } catch (err) { next(err); }
}

// ─── Item documents ───

export async function uploadItemDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json(await onboardingService.uploadItemDocument(
      Number(req.params.itemId),
      { originalname: req.file.originalname, buffer: req.file.buffer },
      req.user!.userId
    ));
  } catch (err) { next(err); }
}

export async function downloadItemDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { absPath, name } = await onboardingService.getItemDocument(Number(req.params.itemId));
    res.download(absPath, name);
  } catch (err) { next(err); }
}

export async function removeItemDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await onboardingService.removeItemDocument(Number(req.params.itemId)));
  } catch (err) { next(err); }
}

export async function previewOfferLetterPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { candidateName, designation, salary, joiningDate, employeeCode } = req.body;
    const generatedDate = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

    const pdfBuffer = await generateOfferLetterPdf({
      candidateName: candidateName || 'Candidate Name',
      designation: designation || 'Designation',
      salary: salary || '0',
      joiningDate: joiningDate
        ? new Date(joiningDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
        : '—',
      employeeCode: employeeCode || '—',
      generatedBy: req.user!.email,
      generatedDate,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
}
