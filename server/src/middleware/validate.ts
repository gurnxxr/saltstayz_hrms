import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validate a request against a Zod schema shaped `{ body?, query?, params? }` and — the
 * part that was previously missing — write the PARSED result back onto `req`, so
 * downstream handlers receive coerced, defaulted and unknown-key-stripped values rather
 * than the raw input. Without the write-back, zod's coercion/defaults were computed and
 * thrown away, which made `validate()` a no-op even where it was wired in.
 *
 * `req.query` / `req.params` are writable under Express 4; the assignments are guarded so
 * a read-only setter (should the runtime change) degrades to "validated but not rewritten"
 * instead of throwing.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as { body?: unknown; query?: unknown; params?: unknown };

      if (parsed && typeof parsed === 'object') {
        if ('body' in parsed) req.body = parsed.body;
        if ('query' in parsed) {
          try { (req as unknown as { query: unknown }).query = parsed.query; } catch { /* read-only in some runtimes */ }
        }
        if ('params' in parsed) {
          try { (req as unknown as { params: unknown }).params = parsed.params; } catch { /* read-only in some runtimes */ }
        }
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}
