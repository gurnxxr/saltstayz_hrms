import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isMailConfigured, sendMail, lastSentMail, resetMailbox } from './mailer';

/**
 * The mail seam, tested without a mail server.
 *
 * `isMailConfigured` is the whole feature's kill switch: `passwordReset.service` consults it before
 * generating a code and before redeeming one, so getting it wrong either silently disables password
 * reset on a correctly configured box, or claims a code is on its way from one that cannot send.
 * These are pure — no database, no socket, no `app` import.
 *
 * `TEST_SMTP_JSON` swaps nodemailer's jsonTransport in for the real one so the `smtp` branch of the
 * switch is genuinely executed rather than mocked out.
 */

const ORIGINAL = { ...process.env };

function envFor(vars: Record<string, string | undefined>) {
  for (const key of ['MAIL_PROVIDER', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'TEST_SMTP_JSON']) {
    delete process.env[key];
  }
  Object.assign(process.env, vars);
}

beforeEach(() => {
  envFor({});
  resetMailbox();
});

afterAll(() => {
  process.env = { ...ORIGINAL };
});

describe('isMailConfigured', () => {
  it('is false with no provider — the default a fresh environment starts in', () => {
    envFor({ MAIL_PROVIDER: undefined });
    expect(isMailConfigured()).toBe(false);
    envFor({ MAIL_PROVIDER: 'none' });
    expect(isMailConfigured()).toBe(false);
  });

  it('is true for the two development providers', () => {
    envFor({ MAIL_PROVIDER: 'log' });
    expect(isMailConfigured()).toBe(true);
    envFor({ MAIL_PROVIDER: 'memory' });
    expect(isMailConfigured()).toBe(true);
  });

  // Half-configured SMTP is the realistic failure: somebody sets the host, restarts, and expects
  // it to work. Answering true there means every code silently fails to send while the flow still
  // says one is on its way — strictly worse than the feature staying off.
  it('is false while SMTP is only half configured', () => {
    envFor({ MAIL_PROVIDER: 'smtp' });
    expect(isMailConfigured()).toBe(false);

    envFor({ MAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.gmail.com' });
    expect(isMailConfigured()).toBe(false);

    envFor({ MAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'hr@saltstayz.com' });
    expect(isMailConfigured()).toBe(false);
  });

  it('is true once SMTP has a host, a user and a password', () => {
    envFor({
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'hr@saltstayz.com',
      SMTP_PASSWORD: 'app-password',
    });
    expect(isMailConfigured()).toBe(true);
  });

  // env.RESEND_API_KEY is snapshotted at import and empty in this suite, so naming the provider
  // without the key must not be enough. Same shape as the SMTP case above.
  it('is false for resend without an API key', () => {
    envFor({ MAIL_PROVIDER: 'resend' });
    expect(isMailConfigured()).toBe(false);
  });
});

describe('sendMail', () => {
  const MSG = { to: 'priya@saltstayz.com', subject: 'Your SaltStayz HRMS password reset code', text: 'Your code is 123456' };

  it('refuses when no provider is configured', async () => {
    envFor({ MAIL_PROVIDER: 'none' });
    await expect(sendMail(MSG)).rejects.toThrow(/MAIL_PROVIDER=none/);
  });

  it('refuses when SMTP is named but not finished', async () => {
    envFor({ MAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.gmail.com' });
    await expect(sendMail(MSG)).rejects.toThrow(/SMTP_HOST, SMTP_USER or SMTP_PASSWORD is empty/);
  });

  it('hands a complete message to the SMTP transport', async () => {
    envFor({
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'hr@saltstayz.com',
      SMTP_PASSWORD: 'app-password',
      TEST_SMTP_JSON: 'true',
    });
    const result = await sendMail(MSG);
    expect(result).toEqual({ delivered: true, provider: 'smtp' });
  });

  it('parks the message in memory under the test provider', async () => {
    envFor({ MAIL_PROVIDER: 'memory' });
    await sendMail(MSG);
    expect(lastSentMail()?.text).toContain('123456');
  });
});
