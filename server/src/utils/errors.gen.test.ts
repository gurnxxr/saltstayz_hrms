import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  GuardrailError,
} from './errors';
import { errorHandler } from '../middleware/errorHandler';

// A minimal Express Response double that records the last status/json.
function mockRes() {
  const res: any = {
    _status: undefined as number | undefined,
    _json: undefined as unknown,
  };
  res.status = (code: number) => {
    res._status = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res._json = payload;
    return res;
  };
  return res;
}

describe('AppError', () => {
  it('sets message, statusCode, isOperational and details', () => {
    const err = new AppError('boom', 418, { a: 1 });
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(418);
    expect(err.isOperational).toBe(true);
    expect(err.details).toEqual({ a: 1 });
  });

  it('is an instance of Error and AppError', () => {
    const err = new AppError('boom', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('leaves details undefined when not provided', () => {
    const err = new AppError('boom', 500);
    expect(err.details).toBeUndefined();
  });

  it('preserves falsy details values (0, null, empty string, false)', () => {
    expect(new AppError('m', 400, 0).details).toBe(0);
    expect(new AppError('m', 400, null).details).toBeNull();
    expect(new AppError('m', 400, '').details).toBe('');
    expect(new AppError('m', 400, false).details).toBe(false);
  });

  it('captures a stack trace', () => {
    const err = new AppError('boom', 500);
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('boom');
  });

  it('exposes the subclass name via constructor.name', () => {
    // The classes do not override instance .name, but constructor.name is intact.
    expect(new AppError('m', 500).constructor.name).toBe('AppError');
  });

  it('preserves an arbitrary statusCode verbatim (no clamping/normalization)', () => {
    expect(new AppError('m', 200).statusCode).toBe(200);
    expect(new AppError('m', 599).statusCode).toBe(599);
  });
});

describe('NotFoundError', () => {
  it('defaults resource to "Resource" and maps to 404', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('Resource not found');
    expect(err.statusCode).toBe(404);
  });

  it('interpolates the provided resource name', () => {
    const err = new NotFoundError('Employee');
    expect(err.message).toBe('Employee not found');
    expect(err.statusCode).toBe(404);
  });

  it('is operational and instanceof AppError/Error', () => {
    const err = new NotFoundError('Leave request');
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('does not carry details', () => {
    expect(new NotFoundError('X').details).toBeUndefined();
  });

  it('handles an empty-string resource (documents the interpolation edge)', () => {
    // Passing '' is not the default, so it is used verbatim -> ' not found'.
    expect(new NotFoundError('').message).toBe(' not found');
  });
});

describe('UnauthorizedError', () => {
  it('defaults message to "Unauthorized" and maps to 401', () => {
    const err = new UnauthorizedError();
    expect(err.message).toBe('Unauthorized');
    expect(err.statusCode).toBe(401);
  });

  it('uses a custom message when provided', () => {
    const err = new UnauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
    expect(err.statusCode).toBe(401);
  });

  it('is operational and part of the AppError hierarchy', () => {
    const err = new UnauthorizedError();
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ForbiddenError', () => {
  it('defaults message to "Forbidden" and maps to 403', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('Forbidden');
    expect(err.statusCode).toBe(403);
  });

  it('uses a custom message when provided', () => {
    const err = new ForbiddenError('Not allowed for your role');
    expect(err.message).toBe('Not allowed for your role');
    expect(err.statusCode).toBe(403);
  });

  it('is operational and part of the AppError hierarchy', () => {
    const err = new ForbiddenError();
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ValidationError', () => {
  it('defaults message to "Validation failed" and maps to 400', () => {
    const err = new ValidationError();
    expect(err.message).toBe('Validation failed');
    expect(err.statusCode).toBe(400);
  });

  it('uses a custom message when provided', () => {
    const err = new ValidationError('email is required');
    expect(err.message).toBe('email is required');
    expect(err.statusCode).toBe(400);
  });

  it('is operational and part of the AppError hierarchy', () => {
    const err = new ValidationError();
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('does not carry details', () => {
    expect(new ValidationError('x').details).toBeUndefined();
  });
});

describe('GuardrailError', () => {
  it('maps to 409 and carries the message + structured details', () => {
    const snapshot = { headcount: 12, sanctioned: 10, variance: 2 };
    const err = new GuardrailError('Over headcount', snapshot);
    expect(err.message).toBe('Over headcount');
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual(snapshot);
  });

  it('is operational and part of the AppError hierarchy', () => {
    const err = new GuardrailError('m', {});
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GuardrailError);
  });

  it('passes details through by reference (same object)', () => {
    const snapshot = { band: 'B3' };
    const err = new GuardrailError('m', snapshot);
    expect(err.details).toBe(snapshot);
  });

  it('preserves a null details payload', () => {
    const err = new GuardrailError('m', null);
    expect(err.details).toBeNull();
  });
});

describe('distinct status codes per class', () => {
  it('each class maps to its documented HTTP status', () => {
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new ValidationError().statusCode).toBe(400);
    expect(new GuardrailError('m', {}).statusCode).toBe(409);
  });
});

describe('errorHandler mapping consistency', () => {
  it('maps an AppError to its statusCode with { error: message }', () => {
    const res = mockRes();
    errorHandler(new NotFoundError('Employee'), {} as any, res as any, (() => {}) as any);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Employee not found' });
  });

  it('includes details only when details !== undefined', () => {
    const res = mockRes();
    const snapshot = { variance: 3 };
    errorHandler(new GuardrailError('Over budget', snapshot), {} as any, res as any, (() => {}) as any);
    expect(res._status).toBe(409);
    expect(res._json).toEqual({ error: 'Over budget', details: snapshot });
  });

  it('omits the details key entirely when an AppError has no details', () => {
    const res = mockRes();
    errorHandler(new ValidationError('bad'), {} as any, res as any, (() => {}) as any);
    expect(res._json).toEqual({ error: 'bad' });
    expect('details' in (res._json as object)).toBe(false);
  });

  it('includes details when they are falsy-but-defined (null)', () => {
    const res = mockRes();
    errorHandler(new GuardrailError('m', null), {} as any, res as any, (() => {}) as any);
    expect(res._json).toEqual({ error: 'm', details: null });
    expect('details' in (res._json as object)).toBe(true);
  });

  it('maps a plain (non-AppError) Error to a generic 500', () => {
    const res = mockRes();
    errorHandler(new Error('leaked internals'), {} as any, res as any, (() => {}) as any);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ error: 'Internal server error' });
    // The raw message must never reach the client.
    expect(JSON.stringify(res._json)).not.toContain('leaked internals');
  });
});
