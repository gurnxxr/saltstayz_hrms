# Client Rules

## Next.js 16 (App Router)

This is NOT the Next.js from training data. Breaking changes exist. Check `node_modules/next/dist/docs/` when unsure.

- All page components are `'use client'` (this app doesn't use RSC)
- Dynamic params are Promises: `{ params }: { params: Promise<{ id: string }> }` → `const { id } = use(params)`
- Wrap pages in `<AppShell>` for sidebar/header layout
- Path alias: `@/` maps to `./src/`

## Component Patterns

```typescript
// Page structure
'use client';
import AppShell from '@/components/layout/AppShell';
export default function MyPage() {
  return <AppShell><div className="space-y-6">...</div></AppShell>;
}
```

## Data Fetching

- Use `@tanstack/react-query` for all server state
- API client: `import api from '@/lib/api'` (axios, baseURL already set)
- Queries: `useQuery({ queryKey: ['key'], queryFn: () => api.get('/path').then(r => r.data) })`
- Mutations: `useMutation({ mutationFn: ..., onSuccess: () => queryClient.invalidateQueries(...) })`
- Toast notifications: `import { toast } from 'sonner'`

## Auth & Permissions

- `useAuth()` from `@/lib/auth` — returns `{ user, login, logout, can }`
- `user.roleName` — one of: admin, chro, hr, hr_manager, property_manager, employee, finance
- `usePermissions()` from `@/hooks/usePermissions` — `isAdmin`, `isCHRO`, `isHR`, etc.
- Admin check: `const isAdmin = user?.roleName === 'admin'`

## Styling

- Tailwind CSS v4 — use utility classes only, no CSS modules
- Color tokens: `text-foreground`, `text-secondary`, `bg-card`, `bg-muted`, `border-border`, `bg-primary`
- Icons: `lucide-react` — import individually: `import { Plus, Clock } from 'lucide-react'`
- Forms: `react-hook-form` + `zod` for validation
- Charts: `recharts`

## Navigation

Sidebar nav is defined in `client/src/lib/constants.ts` → `NAVIGATION` array. Each entry: `{ label, href, icon, roles }`. Icons must be in the `iconMap` in `Sidebar.tsx`.
