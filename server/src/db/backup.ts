/**
 * CLI backup entry point. Run on demand or from a scheduler (cron / Windows Task
 * Scheduler): `npm run db:backup --workspace=server`.
 */
import { runBackup, listBackups } from '../services/backup.service';

(async () => {
  const r = await runBackup();
  console.log(`Backup created: ${r.file} (${(r.size / 1024).toFixed(0)} KB)`);
  if (r.pruned) console.log(`Pruned ${r.pruned} old backup(s).`);
  console.log(`Backups retained: ${listBackups().length}`);
  process.exit(0);
})().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
