import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as orgService from '../services/organization.service';

// Properties
export const listProperties = async (_r: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.listProperties()); } catch (e) { next(e); } };
export const createProperty = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.status(201).json(await orgService.createProperty(req.body)); } catch (e) { next(e); } };
export const updateProperty = async (req: AuthRequest, res: Response, next: NextFunction) => { try { res.json(await orgService.updateProperty(Number(req.params.id), req.body)); } catch (e) { next(e); } };
export const deleteProperty = async (req: AuthRequest, res: Response, next: NextFunction) => { try { await orgService.deleteProperty(Number(req.params.id)); res.json({ message: 'Deleted' }); } catch (e) { next(e); } };

export const bulkUploadProperties = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const csv = req.file.buffer.toString('utf-8');
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const nameIdx = header.findIndex(h => h === 'name' || h === 'property_name');
    if (nameIdx === -1) return res.status(400).json({ error: 'CSV must have a "Name" column' });

    const hotelIdx = header.findIndex(h => h === 'hotel_id' || h === 'hotel');
    const cityIdx = header.findIndex(h => h === 'city');
    const addressIdx = header.findIndex(h => h === 'address');
    const categoryIdx = header.findIndex(h => h === 'category');

    const rows = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim());
      return {
        name: cols[nameIdx] || '',
        hotel_id: hotelIdx >= 0 ? cols[hotelIdx] : undefined,
        city: cityIdx >= 0 ? cols[cityIdx] : undefined,
        address: addressIdx >= 0 ? cols[addressIdx] : undefined,
        category: categoryIdx >= 0 ? cols[categoryIdx] : undefined,
      };
    });

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
