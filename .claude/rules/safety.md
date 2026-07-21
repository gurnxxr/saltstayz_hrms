# Safety & Troubleshooting

## Port Conflicts

If `EADDRINUSE` on port 3000 or 5000:
1. Find the PID: `netstat -ano | findstr ":3000" | findstr "LISTENING"`
2. Kill it: `taskkill /PID <number> /F`
3. Restart the server

This happens when dev servers don't shut down cleanly. Always `Ctrl+C` before closing terminal.

## Safe to Do Without Asking

- Read any file in the project
- Edit client/server source code
- Run migrations, seeds
- Start/restart dev servers
- Run `git status`, `git diff`, `git log`
- Install npm packages to client/ or server/ workspace

## Ask Before

- Running `git push`, creating PRs
- Deleting database files or running `db:reset`
- Modifying `.env` files
- Running `taskkill` on user processes
- Any destructive git operation (reset, force push)

## Common Errors

- **`no such column: employees.property_id`** — analytics.service.ts still references dropped columns. Fix the query.
- **Chrome extension timeout on localhost** — Turbopack HMR WebSocket keeps page non-idle. Use `javascript_tool` instead of `find`/`read_page`, or take desktop screenshots.
- **Empty bash output from `npx tsx -e "..."`** — Write to a script file and run `npx tsx scriptfile.ts` instead.
- **`Cannot find module '../db/connection'`** — Wrong import. Use `import db from '../config/database'`.
- **`function round(double precision, integer) does not exist`** — Postgres only has `round(numeric, int)`. Cast: `round(avg(col)::numeric, 1)`.
- **`column "x" is of type boolean but expression is of type integer`** — writing `1`/`0` to a boolean column. Use `true`/`false`.
- **Insert returns `undefined` id** — missing `.returning('id')` on a Postgres insert.
- **`database "hrms" does not exist`** — `DATABASE_URL` points at the wrong Postgres (check for another server already on 5432).
