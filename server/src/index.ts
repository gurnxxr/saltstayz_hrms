import app from './app';
import { env } from './config/env';
import { runBackup } from './services/backup.service';
import { autoMarkAttendance } from './services/attendance.service';

app.listen(env.SERVER_PORT, () => {
  console.log(`Server running on http://localhost:${env.SERVER_PORT}`);
});

// Daily DB backup routine. Auto-enabled in production; opt in elsewhere with
// BACKUP_ENABLED=true (kept off in dev so tsx-watch restarts don't spam backups).
// Manual backups always work via `npm run db:backup` or the admin panel.
if (env.NODE_ENV === 'production' || process.env.BACKUP_ENABLED === 'true') {
  const DAY = 24 * 60 * 60 * 1000;
  const tick = () => runBackup()
    .then((r) => console.log(`[backup] ${r.file} (${Math.round(r.size / 1024)} KB)`))
    .catch((e) => console.error('[backup] failed:', e.message));
  setTimeout(tick, 60 * 1000).unref();   // first run ~1 min after boot
  setInterval(tick, DAY).unref();         // then every 24h
}

// Daily auto-attendance: applies Shift Type thresholds (half-day/absent hours)
// to yesterday's records. Same enablement pattern as backups; the manual
// trigger (POST /attendance/admin/auto-mark) always works regardless.
if (env.NODE_ENV === 'production' || process.env.AUTO_ATTENDANCE_ENABLED === 'true') {
  const DAY = 24 * 60 * 60 * 1000;
  const tick = () => autoMarkAttendance()
    .then((r) => console.log(`[auto-attendance] ${r.date}: ${r.updated}/${r.scanned} records updated`))
    .catch((e) => console.error('[auto-attendance] failed:', e.message));
  setTimeout(tick, 90 * 1000).unref();   // first run ~1.5 min after boot
  setInterval(tick, DAY).unref();         // then every 24h
}
