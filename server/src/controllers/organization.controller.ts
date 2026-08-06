import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as orgService from '../services/organization.service';

// Properties
export const listProperties = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listProperties()); } catch (e) { next(e); } };
export const createProperty = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createProperty(req.body)); } catch (e) { next(e); } };
export const updateProperty = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updateProperty(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deleteProperty = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deleteProperty(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

export interface PropertyCsvRow {
  name: string;
  hotel_id?: string;
  city?: string;
  state?: string;
  address?: string;
  category?: string;
}

/**
 * Turn a properties CSV into rows for `bulkCreateProperties`.
 *
 * Exported and pure ON PURPOSE. This parsing previously lived inline in the handler, where the only
 * way to reach it was a multipart upload — so when `bulkCreateProperties` was changed to require a
 * state and this was not changed to read one, every upload started failing with "no state given"
 * and no test noticed. A property's state decides Professional Tax, Labour Welfare Fund and the
 * minimum wage for everyone working there, which is why the service refuses to guess it.
 *
 * Note the naive `split(',')` is kept deliberately: it is what the file format has always been, and
 * widening it to a quoted parser would change which existing files import. Addresses containing a
 * comma still need quoting support — a separate change if it ever comes up.
 */
export function parsePropertiesCsv(csv: string): PropertyCsvRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const nameIdx = header.findIndex((h) => h === 'name' || h === 'property_name');
  if (nameIdx === -1) throw new Error('CSV must have a "Name" column');

  const at = (...aliases: string[]) => header.findIndex((h) => aliases.includes(h));
  const hotelIdx = at('hotel_id', 'hotel');
  const cityIdx = at('city');
  const stateIdx = at('state');
  const addressIdx = at('address');
  const categoryIdx = at('category');

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    const pick = (idx: number) => (idx >= 0 ? cols[idx] : undefined);
    return {
      name: cols[nameIdx] || '',
      hotel_id: pick(hotelIdx),
      city: pick(cityIdx),
      state: pick(stateIdx),
      address: pick(addressIdx),
      category: pick(categoryIdx),
    };
  });
}

export const bulkUploadProperties = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

    let rows: PropertyCsvRow[];
    try {
      rows = parsePropertiesCsv(req.file.buffer.toString('utf-8'));
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }

    const result = await orgService.bulkCreateProperties(rows);
    res.json(result);
  } catch (e) { next(e); }
};

// Departments
export const listDepartments = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listDepartments()); } catch (e) { next(e); } };
export const createDepartment = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createDepartment(req.body)); } catch (e) { next(e); } };
export const updateDepartment = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updateDepartment(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deleteDepartment = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deleteDepartment(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

// Property Categories
export const listPropertyCategories = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listPropertyCategories()); } catch (e) { next(e); } };
export const createPropertyCategory = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createPropertyCategory(req.body)); } catch (e) { next(e); } };
export const updatePropertyCategory = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updatePropertyCategory(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deletePropertyCategory = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deletePropertyCategory(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

// Branches — the business unit an employee reports into (not a place; see organization.service).
export const listBranches = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listBranches()); } catch (e) { next(e); } };
export const createBranch = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createBranch(req.body)); } catch (e) { next(e); } };
export const updateBranch = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updateBranch(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deleteBranch = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deleteBranch(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

// Job Titles
export const listJobTitles = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listJobTitles()); } catch (e) { next(e); } };
export const createJobTitle = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createJobTitle(req.body)); } catch (e) { next(e); } };
export const updateJobTitle = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updateJobTitle(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deleteJobTitle = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deleteJobTitle(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

// Categories
export const listCategories = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listCategories()); } catch (e) { next(e); } };
export const createCategory = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createCategory(req.body)); } catch (e) { next(e); } };
export const updateCategory = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updateCategory(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deleteCategory = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deleteCategory(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

// Pay Grades
export const listPayGrades = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listPayGrades()); } catch (e) { next(e); } };
export const createPayGrade = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createPayGrade(req.body)); } catch (e) { next(e); } };
export const updatePayGrade = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updatePayGrade(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deletePayGrade = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deletePayGrade(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

// Employment Statuses
export const listStatuses = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listStatuses()); } catch (e) { next(e); } };
export const createStatus = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createStatus(req.body)); } catch (e) { next(e); } };
export const updateStatus = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updateStatus(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deleteStatus = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deleteStatus(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };
