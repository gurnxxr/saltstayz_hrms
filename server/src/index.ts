import app from './app';
import { env } from './config/env';
import { runBackup } from './services/backup.service';
import { autoMarkAttendance } from './services/attendance.service';
import { emit } from './services/notification.service';

const server = app.listen(env.SERVER_PORT, () => {
  console.log(`Server running on http://localhost:${env.SERVER_PORT}`);
});

// Fail loudly and clearly if the port is taken (a stale/duplicate instance) instead of crashing
// with an unhandled EADDRINUSE stack trace.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${env.SERVER_PORT} is already in use — is another server instance running?`);
    process.exit(1);
  }
  throw err;
});

// Release the port and close cleanly on shutdown/reload so the next start doesn't hit EADDRINUSE
// (the main cause of "the server won't come back" after a tsx-watch restart).
const shutdown = (signal: string) => {
  console.log(`${signal} received — shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref(); // safety net if close() hangs
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Daily DB backup routine. Auto-enabled in production; opt in elsewhere with
// BACKUP_ENABLED=true (kept off in dev so tsx-watch restarts don't spam backups).
// Manual backups always work via `npm run db:backup` or the admin panel.
if (env.NODE_ENV === 'production' || process.env.BACKUP_ENABLED === 'true') {
  const DAY = 24 * 60 * 60 * 1000;
  const tick = () => runBackup()
    .then((r) => console.log(`[backup] ${r.file} (${Math.round(r.size / 1024)} KB)`))
    .catch((e) => {
      console.error('[backup] failed:', e.message);
      // A backup can fail every night for a month and, until now, say so only to a log file
      // nobody opens. Admins are ticked for this by default.
      void emit('system.backup_failed', {
        payload: {
          type: 'backup_failed',
          title: 'Nightly backup failed',
          message: `The database backup did not complete: ${e.message}`,
          link: '/admin',
        },
      });
    });
  setTimeout(tick, 60 * 1000).unref();   // first run ~1 min after boot
  setInterval(tick, DAY).unref();         // then every 24h
}

// Daily auto-attendance: applies Shift Type thresholds (half-day/absent hours)
// to yesterday's records. Same enablement pattern as backups. This job is now the
// only way it runs — the manual trigger and its admin button were removed.
if (env.NODE_ENV === 'production' || process.env.AUTO_ATTENDANCE_ENABLED === 'true') {
  const DAY = 24 * 60 * 60 * 1000;
  const tick = () => autoMarkAttendance()
    .then((r) => console.log(`[auto-attendance] ${r.date}: ${r.updated}/${r.scanned} records updated`))
    .catch((e) => {
      console.error('[auto-attendance] failed:', e.message);
      // This job decides half-day/absent verdicts, which decide pay. A silent failure is a month
      // of attendance nobody knows was never marked.
      void emit('system.auto_attendance_failed', {
        payload: {
          type: 'auto_attendance_failed',
          title: 'Auto-attendance job failed',
          message: `Shift thresholds were not applied to yesterday's attendance: ${e.message}`,
          link: '/admin/attendance',
        },
      });
    });
  setTimeout(tick, 90 * 1000).unref();   // first run ~1.5 min after boot
  setInterval(tick, DAY).unref();         // then every 24h
}
