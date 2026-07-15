import { Request } from 'express';

export interface JwtPayload {
  userId: number;
  email: string;
  roleId: number;
  roleName: string;
  employeeId: number | null;
  /** Linked employee's first name — for display (e.g. the dashboard greeting). */
  firstName?: string | null;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export type Permission = {
  module: string;
  action: string;
};
