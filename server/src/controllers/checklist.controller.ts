import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as checklistService from '../services/checklist.service';

// ─── Templates (admin/chro/hr) ───

export async function listTemplates(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.listTemplates());
  } catch (err) { next(err); }
}

export async function addTemplateItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await checklistService.addTemplateItem(Number(req.params.id), {
      label: req.body.label,
      category: req.body.category,
    }));
  } catch (err) { next(err); }
}

export async function updateTemplateItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only forward keys actually present — the service branches on `in data`.
    const data: { label?: string; category?: string; is_active?: boolean } = {};
    if ('label' in req.body) data.label = req.body.label;
    if ('category' in req.body) data.category = req.body.category;
    if ('is_active' in req.body) data.is_active = req.body.is_active;
    res.json(await checklistService.updateTemplateItem(Number(req.params.id), data));
  } catch (err) { next(err); }
}

export async function deleteTemplateItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.deleteTemplateItem(Number(req.params.id)));
  } catch (err) { next(err); }
}

// ─── Instances ───

export async function getInstance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.getInstance(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function addItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await checklistService.addItem(Number(req.params.id), {
      label: req.body.label,
      category: req.body.category,
    }));
  } catch (err) { next(err); }
}

// ─── Items ───

export async function toggleItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.toggleItem(Number(req.params.itemId), req.user!.userId));
  } catch (err) { next(err); }
}

export async function completeAllItems(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.completeAllItems(Number(req.params.id), req.user!.userId));
  } catch (err) { next(err); }
}

export async function deleteItem(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.deleteItem(Number(req.params.itemId)));
  } catch (err) { next(err); }
}

export async function uploadItemDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json(await checklistService.uploadItemDocument(
      Number(req.params.itemId),
      { originalname: req.file.originalname, buffer: req.file.buffer },
      req.user!.userId
    ));
  } catch (err) { next(err); }
}

export async function downloadItemDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { absPath, name } = await checklistService.getItemDocument(
      Number(req.params.itemId),
      { roleName: req.user!.roleName, employeeId: req.user!.employeeId },
    );
    res.download(absPath, name);
  } catch (err) { next(err); }
}

export async function removeItemDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await checklistService.removeItemDocument(Number(req.params.itemId)));
  } catch (err) { next(err); }
}
