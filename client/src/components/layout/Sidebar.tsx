'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { NAVIGATION } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { RoleName } from '@/lib/types';
import {
  LayoutDashboard, Users, CalendarCheck, Clock,
  UserPlus, UserMinus, UserCircle, Briefcase, BarChart3, FileText, Wallet, Settings, LogOut, Landmark,
  ShieldCheck, Building2, ChevronLeft, ChevronRight,
} from 'lucide-react';

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard, Users, UserCircle, CalendarCheck, Clock,
  UserPlus, UserMinus, Briefcase, BarChart3, FileText, Wallet, Settings, Landmark,
  ShieldCheck, Building2,
};

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { user, logout, overrides } = useAuth();

  if (!user) return null;

  // Base visibility is role-based; per-employee overrides add (granted) or remove (denied) modules.
  const granted = overrides?.granted ?? [];
  const denied = overrides?.denied ?? [];
  const filteredNav = NAVIGATION.filter(item => {
    const roleAllowed = item.roles.includes(user.roleName as RoleName);
    if (!item.module) return roleAllowed;
    if (denied.includes(item.module)) return false;
    return roleAllowed || granted.includes(item.module);
  });

  return (
    <aside
      className={cn(
        'bg-sidebar-bg text-sidebar-text flex flex-col h-full fixed left-0 top-0 z-30 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Brand + collapse toggle */}
      <div className={cn('border-b border-white/10 flex items-center h-16', collapsed ? 'justify-center' : 'justify-between px-4')}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white font-bold text-lg shrink-0">S</div>
            <div className="min-w-0">
              <h1 className="text-white font-semibold text-base leading-tight truncate">SaltStayz</h1>
              <p className="text-[11px] text-sidebar-text/60">HRMS</p>
            </div>
          </Link>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          className="p-1.5 rounded-lg text-sidebar-text hover:bg-sidebar-hover hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {filteredNav.map((item) => {
          const Icon = iconMap[item.icon] || LayoutDashboard;
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-sidebar-active text-white'
                  : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
              )}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-white/10">
        <button
          onClick={logout}
          title={collapsed ? 'Sign Out' : undefined}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-white transition-colors w-full',
            collapsed && 'justify-center px-0'
          )}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && 'Sign Out'}
        </button>
      </div>
    </aside>
  );
}
