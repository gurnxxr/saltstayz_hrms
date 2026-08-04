import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The boot guards in `config/env.ts`.
 *
 * These only ever fire once, at import, which makes them easy to weaken by accident and impossible
 * to notice until a staging box is already sending real codes. `vi.resetModules()` plus a dynamic
 * import is the only way to re-run module evaluation with different environment variables — a
 * static import at the top of this file would be hoisted above every assignment below.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function importEnv() {
  vi.resetModules();
  return import('./env');
}

describe('OTP_PEPPER is required of any provider that can send real mail', () => {
  // The pepper's fallback chain ends at a literal in env.ts, and therefore in this repository. A
  // provider that reaches real mailboxes while the HMAC key protecting the codes is public makes
  // every live row in `verification` recoverable by anyone who can read the source.
  for (const provider of ['resend', 'smtp']) {
    it(`refuses to boot with MAIL_PROVIDER=${provider} and no pepper`, async () => {
      process.env.MAIL_PROVIDER = provider;
      delete process.env.OTP_PEPPER;
      await expect(importEnv()).rejects.toThrow(/OTP_PEPPER/);
    });

    it(`boots with MAIL_PROVIDER=${provider} once the pepper is set`, async () => {
      process.env.MAIL_PROVIDER = provider;
      process.env.OTP_PEPPER = 'a-pepper-that-is-not-in-the-repository';
      const { env } = await importEnv();
      expect(env.MAIL_PROVIDER).toBe(provider);
    });
  }

  // The dev providers cannot reach a real mailbox, so they are exempt — requiring a pepper there
  // would mean nothing runs locally without configuration, which is what the fallback is for.
  for (const provider of ['none', 'log', 'memory']) {
    it(`does not demand a pepper for MAIL_PROVIDER=${provider}`, async () => {
      process.env.MAIL_PROVIDER = provider;
      delete process.env.OTP_PEPPER;
      process.env.NODE_ENV = 'development';
      const { env } = await importEnv();
      expect(env.OTP_PEPPER).toBeTruthy();
    });
  }
});

describe('development-only providers are refused in production', () => {
  for (const provider of ['log', 'memory']) {
    it(`refuses MAIL_PROVIDER=${provider} when NODE_ENV=production`, async () => {
      process.env.NODE_ENV = 'production';
      process.env.MAIL_PROVIDER = provider;
      process.env.BETTER_AUTH_SECRET = 'long-enough-secret-for-better-auth-to-accept-it';
      process.env.DATABASE_URL = 'postgres://user:pass@example.com:5432/hrms';
      await expect(importEnv()).rejects.toThrow(/must never run in production/);
    });
  }

  it('accepts smtp in production, given a pepper', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.OTP_PEPPER = 'a-pepper-that-is-not-in-the-repository';
    process.env.BETTER_AUTH_SECRET = 'long-enough-secret-for-better-auth-to-accept-it';
    process.env.DATABASE_URL = 'postgres://user:pass@example.com:5432/hrms';
    const { env } = await importEnv();
    expect(env.MAIL_PROVIDER).toBe('smtp');
  });
});

describe('SMTP settings', () => {
  it('defaults the port to 587 and STARTTLS', async () => {
    process.env.MAIL_PROVIDER = 'none';
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    const { env } = await importEnv();
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
  });

  it('takes implicit TLS only when asked for it explicitly', async () => {
    process.env.MAIL_PROVIDER = 'none';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    const { env } = await importEnv();
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_SECURE).toBe(true);
  });
});
