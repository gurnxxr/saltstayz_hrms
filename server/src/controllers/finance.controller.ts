import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as financeService from '../services/finance.service';

export async function getAll(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, branch_name } = req.query as { search?: string; branch_name?: string };
    const records = await financeService.getAllBankDetails({ search, branch_name });
    res.json(records);
  } catch (err) { next(err); }
}

export async function getByEmployee(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = Number(req.params.employeeId);
    const record = await financeService.getBankDetailsByEmployee(employeeId);
    if (!record) {
      return res.status(404).json({ error: 'No bank details found for this employee' });
    }
    res.json(record);
  } catch (err) { next(err); }
}

export async function getMyBankDetails(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = req.user!.employeeId!;
    const record = await financeService.getBankDetailsByEmployee(employeeId);
    if (!record) {
      return res.status(404).json({ error: 'No bank details on file' });
    }
    res.json(record);
  } catch (err) { next(err); }
}

export async function upsert(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = Number(req.params.employeeId);
    const { account_name, name_as_per_uid, bank_account_number, pan_card, ifsc_code, branch_name, payment_mode } = req.body;

    if (!account_name || !name_as_per_uid || !bank_account_number || !pan_card || !ifsc_code || !branch_name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    if (!panRegex.test(pan_card.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid PAN format (e.g. ABCDE1234F)' });
    }

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifsc_code.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid IFSC format (e.g. SBIN0001234)' });
    }

    const result = await financeService.upsertBankDetails(employeeId, {
      account_name,
      name_as_per_uid,
      bank_account_number,
      pan_card: pan_card.toUpperCase(),
      ifsc_code: ifsc_code.toUpperCase(),
      branch_name,
      payment_mode: payment_mode || 'Bank Transfer',
    });

    res.status(result.updated ? 200 : 201).json(result);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = Number(req.params.employeeId);
    const deleted = await financeService.deleteBankDetails(employeeId);
    if (!deleted) {
      return res.status(404).json({ error: 'No bank details found' });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const stats = await financeService.getStats();
    res.json(stats);
  } catch (err) { next(err); }
}
