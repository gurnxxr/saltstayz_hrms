export interface User {
  userId: number;
  email: string;
  roleId: number;
  roleName: string;
  employeeId: number | null;
}

export interface Permission {
  module: string;
  action: string;
}

export interface ModuleOverrides {
  granted: string[];
  denied: string[];
}

export interface AuthState {
  user: User | null;
  permissions: Permission[];
  overrides: ModuleOverrides;
  isLoading: boolean;
}

export interface Employee {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  /** 'male' | 'female' | 'other' — drives gender-restricted leave eligibility. */
  gender: string | null;
  /** Derived from the employee's property, not stored. Drives PT / LWF / holidays. */
  state?: string | null;
  date_of_joining: string;
  date_of_exit: string | null;
  department_id: number;
  property_id: number;
  job_title_id: number;
  category_id: number;
  employment_status_id: number;
  reporting_manager_id: number | null;
  pan_number: string;
  aadhaar_number: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_branch_name: string;
  cancelled_cheque_url: string | null;
  photo_url: string | null;
  is_active: boolean;
  department?: Department;
  property?: Property;
  job_title?: JobTitle;
  category?: EmployeeCategory;
  reporting_manager?: Employee;
}

export interface Property {
  id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  is_active: boolean;
}

export interface Department {
  id: number;
  name: string;
  property_id: number;
}

export interface JobTitle {
  id: number;
  title: string;
  description: string;
}

export interface EmployeeCategory {
  id: number;
  name: string;
  is_active: boolean;
}

export interface LeaveType {
  id: number;
  name: string;
  default_days: number;
  is_paid: boolean;
  is_active: boolean;
}

export interface LeaveRequest {
  id: number;
  employee_id: number;
  leave_type_id: number;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approved_by: number | null;
  rejection_reason: string | null;
  employee?: Employee;
  leave_type?: LeaveType;
}

export interface LeaveEntitlement {
  id: number;
  employee_id: number;
  leave_type_id: number;
  leave_period_id: number;
  total_days: number;
  used_days: number;
  leave_type?: LeaveType;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  working_hours: number | null;
  employee?: Employee;
}

export interface ShiftType {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  property_id: number;
  is_active: boolean;
}

export interface Vacancy {
  id: number;
  job_title_id: number;
  department_id: number;
  property_id: number;
  positions: number;
  filled: number;
  status: 'open' | 'closed' | 'on_hold';
  description: string;
  job_title?: JobTitle;
  department?: Department;
  property?: Property;
}

export interface Candidate {
  id: number;
  vacancy_id: number;
  name: string;
  email: string;
  phone: string;
  resume_url: string | null;
  stage: 'screening' | 'interview' | 'shortlisted' | 'offered' | 'rejected';
  notes: string;
  archived?: boolean;
  employee_id?: number | null;
  vacancy?: Vacancy;
}

export type RoleName = 'admin' | 'chro' | 'hr' | 'hr_manager' | 'cluster_hr' | 'property_manager' | 'employee' | 'finance';

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles: RoleName[];
  module?: string;
  children?: NavItem[];
}
