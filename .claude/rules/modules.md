# Module Status

## Built & Working

| Module | Client Route | API Prefix | Notes |
|--------|-------------|------------|-------|
| Auth | `/login` | `/auth` | JWT cookies, 7 roles |
| Dashboard | `/dashboard` | `/analytics` | Role-based redirect |
| Employee Details | `/employees` | `/employees` | 37 real employees from CSV |
| My Profile | `/profile` | `/employees/me` | Editable: phone, father_name, aadhaar |
| Leave & Attendance | `/attendance` | `/leave`, `/attendance` | Combined module with tabs |
| Shifts | `/shifts` | `/shifts` | Drag-drop roster |
| Onboarding | `/onboarding` | `/onboarding` | Checklists, offer letters |
| Recruitment | `/recruitment` | `/recruitment` | Kanban pipeline |
| Analytics | `/analytics` | `/analytics` | Recharts dashboards |
| Admin | `/admin` | `/admin` | Org structure CRUD |

## Partially Built

- **Attendance** — Calendar view works, no check-in/check-out yet
- **Reports** — Route exists, stub page
- **Payroll** — Route exists, stub page

## Adding a New Module

1. Server: service → controller → routes → mount in index.ts
2. Client: page in `app/{module}/page.tsx`, wrap in `<AppShell>`
3. Add to `NAVIGATION` in `client/src/lib/constants.ts` with icon and allowed roles
4. Add icon to `iconMap` in `client/src/components/layout/Sidebar.tsx`
5. Add permissions in seeds if needed (role_permissions table)
