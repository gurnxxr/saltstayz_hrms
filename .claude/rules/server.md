# Server Rules

## Architecture

Every module follows: `routes → controller → service → db(knex)`. Controllers are thin — validate input, call service, send response. Services contain all business logic and DB queries.

## New Route Checklist

1. Create service in `server/src/services/{module}.service.ts`
2. Create controller in `server/src/controllers/{module}.controller.ts`
3. Create routes in `server/src/routes/{module}.routes.ts`
4. Mount in `server/src/routes/index.ts`: `router.use('/{module}', {module}Routes)`
5. Add `router.use(authenticate)` at top of route file
6. Use `authorize('module', 'action')` for each endpoint

## Controller Pattern

```typescript
export async function handler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await service.doThing(req.user!.employeeId!, req.body);
    res.json(result); // or res.status(201).json(result) for creates
  } catch (err) { next(err); }
}
```

## Database

- PostgreSQL via `pg` — connect with `DATABASE_URL`. See `.claude/rules/database.md` for the full
  dialect rules (booleans, `ilike`, date columns, advisory locks).
- Insert must ask for the id: `const [{ id }] = await db('table').insert(data).returning('id')`
- Booleans are real booleans (`true`/`false`, never `1`/`0`); user-facing search uses `ilike`
- Use `db.raw()` for aggregates: `db.raw("SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present")`
- Joins: `db('table as t').join('other as o', 'o.id', 't.other_id')`
- Current employee's ID: `req.user!.employeeId!`
- Current user's role: `req.user!.roleName`

## Migrations

File naming: `{NNN}_{description}.ts`. Run: `npm run db:migrate --workspace=server`.

Always handle both `up()` and `down()`. Use `table.dropColumn()` carefully — SQLite doesn't support dropping multiple columns in one ALTER TABLE.

## File Upload

Use multer with memory storage: `multer({ storage: multer.memoryStorage() })`. Access buffer via `req.file.buffer`.
