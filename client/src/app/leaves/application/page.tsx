import { redirect } from 'next/navigation';

// "Application" was merged into the single Leaves page. Nothing in the repo links here any more —
// the leave.applied notification points at /leaves/my?tab=approvals directly — so this exists only
// for old bookmarks. Same Server Component shape as /leaves, and no blank frame: the previous
// 'use client' + useEffect version painted an empty page before redirecting.
export default function LeaveApplicationRedirect() {
  redirect('/leaves/my?tab=approvals');
}
