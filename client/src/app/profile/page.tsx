'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import {
  User, Phone, Mail, Calendar, Briefcase, Shield,
  Save, Loader2, Hash, CreditCard,
} from 'lucide-react';

export default function ProfilePage() {
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api.get('/employees/me').then(r => r.data),
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    phone: '',
    father_name: '',
    aadhaar_number: '',
  });

  useEffect(() => {
    if (profile) {
      setForm({
        phone: profile.phone || '',
        father_name: profile.father_name || '',
        aadhaar_number: profile.aadhaar_number || '',
      });
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof form) => api.put('/employees/me', data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      toast.success('Profile updated successfully');
      setEditing(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update'),
  });

  // Warn before leaving with unsaved profile edits.
  const dirty = editing && !!profile && (
    form.phone !== (profile.phone || '') ||
    form.father_name !== (profile.father_name || '') ||
    form.aadhaar_number !== (profile.aadhaar_number || '')
  );
  useUnsavedChangesWarning(dirty);

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell>
        <div className="text-center py-20 text-secondary">No employee profile linked to your account.</div>
      </AppShell>
    );
  }

  const managerName = [profile.manager_first_name, profile.manager_last_name].filter(Boolean).join(' ') || 'N/A';

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
            <p className="text-secondary mt-1">View and manage your personal information</p>
          </div>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Edit Profile
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => { setEditing(false); if (profile) setForm({ phone: profile.phone || '', father_name: profile.father_name || '', aadhaar_number: profile.aadhaar_number || '' }); }}
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate(form)}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>
          )}
        </div>

        {/* Profile Card */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="bg-primary px-8 py-6">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-white text-2xl font-bold">
                {profile.first_name[0]}{profile.last_name[0]}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{profile.first_name} {profile.last_name}</h2>
                <p className="text-blue-200 text-sm">{profile.designation_name || 'Employee'}</p>
                <p className="text-blue-200 text-xs mt-0.5">Emp Code: {profile.employee_code}</p>
              </div>
            </div>
          </div>

          <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
            {/* Read-only fields */}
            <InfoRow icon={Hash} label="Emp Code" value={profile.employee_code} />
            <InfoRow icon={User} label="Emp Name (As per UID)" value={`${profile.first_name} ${profile.last_name}`} />
            <InfoRow icon={Calendar} label="DOB (As per UID)" value={profile.date_of_birth ? new Date(profile.date_of_birth).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not set'} />
            {/* Read-only on purpose: gender gates maternity/paternity eligibility, so only
                HR can change it (updateMyProfile allows phone / father_name / aadhaar only). */}
            <InfoRow icon={User} label="Gender" value={profile.gender ? profile.gender[0].toUpperCase() + profile.gender.slice(1) : 'Not set — ask HR to update'} />
            <InfoRow icon={User} label="Reporting Manager" value={managerName} />
            <InfoRow icon={Mail} label="Email Address" value={profile.email || 'N/A'} />
            <InfoRow icon={Calendar} label="Date of Joining" value={profile.date_of_joining ? new Date(profile.date_of_joining).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'} />
            <InfoRow icon={Briefcase} label="Dept Name" value={profile.dept_name || 'N/A'} />
            <InfoRow icon={Briefcase} label="Designation Name" value={profile.designation_name || 'N/A'} />
            <InfoRow icon={Briefcase} label="Property Name" value={profile.branch_name || 'N/A'} />
            <InfoRow icon={CreditCard} label="Status" value={profile.is_active ? 'Active' : 'Inactive'} />

            {/* Editable fields */}
            {editing ? (
              <>
                <EditableRow icon={Phone} label="Phone Number" value={form.phone} onChange={(v) => setForm(p => ({ ...p, phone: v }))} placeholder="Enter phone number" />
                <EditableRow icon={User} label="F_Name (As per UID)" value={form.father_name} onChange={(v) => setForm(p => ({ ...p, father_name: v }))} placeholder="Father's name as per UID" />
                <EditableRow icon={Shield} label="Aadhaar Card No" value={form.aadhaar_number} onChange={(v) => setForm(p => ({ ...p, aadhaar_number: v.replace(/\D/g, '') }))} placeholder="12-digit Aadhaar number" maxLength={12} />
              </>
            ) : (
              <>
                <InfoRow icon={Phone} label="Phone Number" value={profile.phone || 'Not set'} />
                <InfoRow icon={User} label="F_Name (As per UID)" value={profile.father_name || 'Not set'} />
                <InfoRow icon={Shield} label="Aadhaar Card No" value={profile.aadhaar_number ? maskValue(profile.aadhaar_number, 4) : 'Not set'} />
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 p-2 rounded-lg bg-muted/50">
        <Icon size={16} className="text-primary" />
      </div>
      <div>
        <p className="text-xs text-secondary">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function EditableRow({ icon: Icon, label, value, onChange, placeholder, maxLength }: {
  icon: React.ElementType; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string; maxLength?: number;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 p-2 rounded-lg bg-muted/50">
        <Icon size={16} className="text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-secondary mb-1">{label}</p>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
    </div>
  );
}

function maskValue(value: string, visibleChars: number) {
  if (value.length <= visibleChars) return value;
  return '•'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}
