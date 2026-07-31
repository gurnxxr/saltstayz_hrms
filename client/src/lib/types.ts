export interface User {
  userId: number;
  email: string;
  roleId: number;
  roleName: string;
  employeeId: number | null;
  /** Linked employee's first name, from the auth payload (may be absent on old sessions). */
  firstName?: string | null;
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
  email: string | null;
  phone: string | null;
  address: string | null;
  resume_url: string | null;
  /**
   * Kept in step with CANDIDATE_STAGES in lib/constants.ts (spelled out here rather than
   * imported, because constants.ts already imports RoleName from this file). The server
   * is authoritative — see recruitment.service.ts.
   */
  stage:
    | 'applied' | 'interview' | 'selected' | 'document_collection' | 'offer_released'
    | 'offer_accepted' | 'pre_joining' | 'joining' | 'transferred'
    | 'rejected' | 'offer_declined' | 'no_show';
  notes: string | null;
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
  /**
   * Role-matched gating: the module used to gate this item when the signed-in
   * user's role is 'employee' (falls back to `module` for every other role). Lets
   * a single Dashboard item be gated by `dashboard_employee` for employees and
   * `dashboard_admin` for staff.
   */
  moduleForEmployee?: string;
  children?: NavItem[];
}

/** One holiday as it applies to the signed-in employee (GET /leave/holidays/me). */
export interface HolidayRow {
  id: number;
  name: string;
  /** Bare 'YYYY-MM-DD'. Compare and slice as a string — never parse it with `new Date`. */
  date: string;
  is_national: boolean;
  state: string | null;
  /**
   * How the date lands on THIS person's roster. `weekly_off` means they were already off, so
   * the holiday gains them nothing. Same verdict the payroll engine reaches.
   */
  falls_on: 'working' | 'weekly_off';
  /** The policy that decided the day — their shift, leave template, or the company work week. */
  decided_by_name: string;
  /** Length of the run of non-working days this holiday sits inside. */
  break_days: number;
  break_start: string;
  break_end: string;
  /** The run hit the edge of the measured window, so `break_days` is a floor. Suppress it. */
  break_bounded: boolean;
  in_employment: boolean;
  employment_note: string | null;
}

/**
 * Why the holiday list looks the way it does. Only `no_holidays_published` is genuinely empty —
 * the other three still return national holidays, and the UI shows them under a warning.
 */
export type HolidayScopeStatus =
  | 'ok'
  | 'no_holidays_published'
  /** Published, but none of it has been given to this person's department or hotel yet. */
  | 'no_holidays_for_you'
  | 'no_state_on_property'
  | 'branch_not_matched'
  | 'no_branch_on_profile';

/** The department axis, reported separately so both problems can be shown at once. */
export type HolidayDeptStatus =
  | 'ok'
  | 'no_department_on_profile'
  | 'department_not_matched';

/** One holiday as the admin screen sees it — with who it was given to, and who that reaches. */
export interface AdminHolidayRow {
  id: number;
  name: string;
  date: string;
  is_national: boolean;
  state: string | null;
  all_departments: boolean;
  all_properties: boolean;
  departments: Array<{ id: number; name: string }>;
  properties: Array<{ id: number; name: string }>;
  department_ids: number[];
  property_ids: number[];
  /** Active employees this actually reaches. Zero is the opt-in trap, and the only way to see it. */
  reaches_count: number;
}

export interface MyHolidaysResponse {
  year: string;
  scope_status: HolidayScopeStatus;
  dept_status: HolidayDeptStatus;
  /** The raw work location on the profile, so a mismatch can be quoted back to the person. */
  branch_name: string | null;
  /** Likewise the raw department. */
  dept_name: string | null;
  region: { property_id: number; property_name: string; state: string | null } | null;
  department: { department_id: number; department_name: string } | null;
  available_years: number[];
  counts: {
    total: number;
    remaining: number;
    this_month: number;
    rest_day_clashes: number;
    long_weekends: number;
  };
  holidays: HolidayRow[];
}
