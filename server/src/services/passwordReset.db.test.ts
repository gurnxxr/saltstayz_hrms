import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import db from '../config/database';
import { env } from '../config/env';
import { lastSentMail, resetMailbox } from './mailer';
import { whenRequestSettled } from './passwordReset.service';

/**
 * The password-reset flow end to end, against a real database and the real Express app.
 *
 * The assertions that matter here are not "does it work" — they are "does it refuse to say
 * anything". This is the only unauthenticated way to change a credential in a system holding
 * salaries and Aadhaar numbers, so the interesting properties are all negative ones: a stranger
 * cannot learn whether an address is registered, cannot tell a wrong code from an expired one,
 * cannot self-register, cannot keep guessing, and cannot deny recovery to someone else.
 *
 * `MAIL_PROVIDER=memory` parks the code in memory so it is readable here without ever being logged.
 *
 * SKIPS unless DATABASE_URL names a throwaway database — same gate as the other *.db.test.ts files.
 */
const ON_THROWAWAY = /hrms_(test|qa)/.test(process.env.DATABASE_URL || '');

const EMAIL = 'reset-test@saltstayz.test';
const UNKNOWN = 'nobody-at-all@saltstayz.test';
const OLD_PASSWORD = 'old-password-123';
const NEW_PASSWORD = 'a-much-longer-new-password';

/** The code that was mailed. Only reachable because the memory provider parked it. */
const mailedOtp = (): string => {
  const body = lastSentMail()?.text ?? '';
  return (body.match(/\b(\d{6})\b/) || [])[1] ?? '';
};

describe.skipIf(!ON_THROWAWAY)('password reset', () => {
  let app: any;
  let server: http.Server;
  let rateStore: { resetAll: () => void };
  let userId: number;

  beforeAll(async () => {
    // `mailer.currentProvider()` reads this per call, so it takes effect regardless of import order.
    process.env.MAIL_PROVIDER = 'memory';
    const appModule = await import('../app');
    app = appModule.default;
    rateStore = appModule.passwordResetRateStore as any;
    const { auth } = await import('../config/auth');

    await db('users').whereRaw('lower(email) = lower(?)', [EMAIL]).del();
    // Created through the app's OWN path, not auth.api.signUpEmail. Sign-up is not a flow this
    // product has: `users.role_id` is NOT NULL and Better Auth never sets it, so signUpEmail dies
    // on a constraint. `createUser` writes the row and the `account` credential exactly as the
    // admin screens do, which is what a real account looks like.
    const roleId = (await db('roles').orderBy('id').first())!.id;
    const { createUser } = await import('./user.service');
    const created: any = await createUser({ email: EMAIL, password: OLD_PASSWORD, role_id: roleId });
    userId = created.id ?? created.user_id;
    await db('users').where('id', userId).update({ is_active: true });
    void auth;

    // A real listener, for the raw-socket cases below.
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  /**
   * POST over a raw socket, sending the path EXACTLY as written.
   *
   * supertest normalises the path in its client, so `%2e` and `//` were rewritten before the
   * request ever left the process — a test built on it asserted against the already-safe spelling
   * and proved nothing. Node's http.request passes the path through untouched, which is what an
   * attacker's `curl --path-as-is` does.
   */
  const rawPost = (path: string, body: unknown): Promise<{ status: number; body: string }> => {
    const payload = JSON.stringify(body);
    const { port } = server.address() as AddressInfo;
    return new Promise((resolve, reject) => {
      const r = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data.trim() }));
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
  };

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (userId) {
      await db('password_reset_throttle').where('user_id', userId).del();
      await db('session').where('userId', userId).del();
      await db('account').where('userId', userId).del();
      await db('users').where('id', userId).del();
    }
    await db('audit_logs').where('path', 'like', 'password-reset/%').del();
    await db.destroy();
  });

  beforeEach(async () => {
    resetMailbox();
    // Every request in this file arrives from the same address, so without this the suite spends
    // the per-IP budget on itself and the later cases measure 429s instead of what they assert.
    // The limiter itself stays live and production-shaped; it gets its own case at the end.
    rateStore.resetAll();
    await db('password_reset_throttle').where('user_id', userId).del();
    await db('verification').whereRaw('identifier ilike ?', ['%forget-password%']).del();
    // Cleared here, not only in the audit test — otherwise that test can assert on a row left by an
    // earlier case or an earlier run of the suite and pass without the current request writing one.
    await db('audit_logs').where('path', 'like', 'password-reset/%').del();
  });

  const req = () => request(app);

  /**
   * Ask for a code and wait for the detached work to finish.
   *
   * `requestReset` answers before it looks anything up — that is what stops the response time being
   * an account-existence oracle — so the mail has not necessarily been sent when the 202 lands.
   */
  const askForCode = async (email: string) => {
    const res = await req().post('/api/v1/password-reset/request').send({ email });
    await whenRequestSettled();
    return res;
  };

  // ─── The thing a stranger must not be able to learn ───

  it('answers a registered and an unregistered address identically', async () => {
    // Each request gets a fresh IP budget so the RateLimit-* headers can be compared. Otherwise the
    // second request reports one fewer remaining and the comparison fails on a difference that has
    // nothing to do with which address was asked about.
    const known = await askForCode(EMAIL);
    rateStore.resetAll();
    const unknown = await askForCode(UNKNOWN);

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    // Header sets must match too — a stray Retry-After or differing Content-Length would leak it.
    const strip = (h: Record<string, string>) => {
      const { date, etag, ...rest } = h as any; void date; void etag; return rest;
    };
    expect(strip(known.headers)).toEqual(strip(unknown.headers));
  });

  it('does no account work before answering, so the reply cannot be timed', async () => {
    // The response used to be written only after a locked transaction and a round-trip to the mail
    // provider, so a registered address answered ~100x slower than an unknown one and one probe
    // classified it. Asserting on wall-clock would be flaky; asserting on the ORDER is not. If the
    // 202 arrives while the mailbox is still empty, nothing account-dependent preceded it.
    resetMailbox();
    const res = await req().post('/api/v1/password-reset/request').send({ email: EMAIL });
    expect(res.status).toBe(202);
    expect(lastSentMail(), 'the reply waited for the mail to be sent').toBeNull();

    await whenRequestSettled();
    expect(lastSentMail()?.to).toBe(EMAIL); // …and it really was sent, just afterwards
  });

  it('sends a code for the known address and nothing for the unknown one', async () => {
    await askForCode(UNKNOWN);
    expect(lastSentMail()).toBeNull();

    await askForCode(EMAIL);
    expect(lastSentMail()?.to).toBe(EMAIL);
    expect(mailedOtp()).toMatch(/^\d{6}$/);
  });

  it('stores the code as an HMAC under our pepper, not as a bare digest', async () => {
    await askForCode(EMAIL);
    const otp = mailedOtp();
    const rows = await db('verification').select('identifier', 'value');
    expect(rows.length).toBeGreaterThan(0);

    // Not merely "the plaintext is absent" — that also holds for the plugin's own `storeOTP:
    // "hashed"`, which is an unsalted SHA-256 and therefore a one-million-entry rainbow table for a
    // six-digit code. This asserts the stored value IS the keyed hash, so dropping the pepper or
    // falling back to the plugin's default fails here.
    const expected = createHmac('sha256', env.OTP_PEPPER).update(otp).digest('base64url');
    const stored = rows.map((r: any) => String(r.value));
    expect(stored.some((v) => v.includes(expected))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(otp);
  });

  it('gives one identical rejection for every way a confirmation can fail', async () => {
    await askForCode(EMAIL);
    const good = mailedOtp();
    const wrong = good === '000000' ? '111111' : '000000';

    const cases = [
      { label: 'unknown address', body: { email: UNKNOWN, otp: '123456', newPassword: NEW_PASSWORD } },
      { label: 'wrong code', body: { email: EMAIL, otp: wrong, newPassword: NEW_PASSWORD } },
      // A REAL account with no code outstanding — the case the old test thought it covered but did
      // not, because the address it used had never been registered either.
      { label: 'no code outstanding', body: { email: EMAIL, otp: '123456', newPassword: NEW_PASSWORD } },
      // Schema failures must not speak either: "at least 10 character(s)" told an attacker the code
      // had been accepted and only the password refused.
      { label: 'weak password', body: { email: EMAIL, otp: wrong, newPassword: 'short' } },
      { label: 'malformed code', body: { email: EMAIL, otp: 'abcdef', newPassword: NEW_PASSWORD } },
    ];
    const seen = new Set<string>();
    for (const c of cases) {
      await db('verification').whereRaw('identifier ilike ?', ['%forget-password%']).del();
      const res = await req().post('/api/v1/password-reset/confirm').send(c.body);
      seen.add(`${res.status} ${JSON.stringify(res.body)}`);
    }
    // Every failure mode collapses to exactly one observable answer.
    expect(seen.size, `distinguishable answers: ${[...seen].join(' | ')}`).toBe(1);
    expect([...seen][0]).toMatch(/^400 /);
    void good;
  });

  // ─── The happy path, and what it must invalidate ───

  it('resets the password, and the old one stops working', async () => {
    const { auth } = await import('../config/auth');
    await askForCode(EMAIL);

    const res = await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp: mailedOtp(), newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    await expect(auth.api.signInEmail({ body: { email: EMAIL, password: OLD_PASSWORD } })).rejects.toThrow();
    const ok = await auth.api.signInEmail({ body: { email: EMAIL, password: NEW_PASSWORD } });
    expect(ok).toBeTruthy();

    // Put it back so the remaining tests start from a known credential.
    await askForCode(EMAIL);
    await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp: mailedOtp(), newPassword: OLD_PASSWORD });
  });

  it('burns the code — the same one cannot be used twice', async () => {
    await askForCode(EMAIL);
    const otp = mailedOtp();

    const first = await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp, newPassword: NEW_PASSWORD });
    expect(first.status).toBe(200);

    const replay = await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp, newPassword: 'yet-another-password-9' });
    expect(replay.status).toBe(400);

    await askForCode(EMAIL);
    await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp: mailedOtp(), newPassword: OLD_PASSWORD });
  });

  it('refuses a weak password even though the global minimum is four characters', async () => {
    // config/auth.ts allows 4 so the seeded "1234" logins keep working. This path must not inherit
    // that, or the reset flow becomes a way to downgrade an account rather than recover it.
    await askForCode(EMAIL);
    const res = await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp: mailedOtp(), newPassword: 'short' });
    expect(res.status).toBe(400);

    const { auth } = await import('../config/auth');
    await expect(auth.api.signInEmail({ body: { email: EMAIL, password: 'short' } })).rejects.toThrow();
  });

  // ─── Budgets ───

  it('stops issuing codes once the per-account window is spent', async () => {
    // The cooldown is bypassed by ageing the row, so this exercises the WINDOW cap specifically.
    for (let i = 0; i < 3; i += 1) {
      await askForCode(EMAIL);
      // Positive control for each issue: the cap is only meaningful if these three SUCCEEDED.
      expect(lastSentMail()?.to, `issue ${i + 1} should have been sent`).toBe(EMAIL);
      resetMailbox();
      await db('password_reset_throttle').where('user_id', userId)
        .update({ last_issued_at: new Date(Date.now() - 120_000) });
    }
    const res = await askForCode(EMAIL);
    expect(res.status).toBe(202);       // still the same answer…
    expect(lastSentMail()).toBeNull();  // …but the fourth was not sent
  });

  it('does not let a stranger burn someone else\'s failure budget', async () => {
    // The failure budget is charged on a wrong code. Charging it when NO code is outstanding turned
    // it into a denial-of-service: anyone who knew a colleague's address could spend it and lock
    // that person out of recovery for an hour.
    for (let i = 0; i < 15; i += 1) {
      await req().post('/api/v1/password-reset/confirm')
        .send({ email: EMAIL, otp: '000000', newPassword: NEW_PASSWORD });
    }
    expect(await db('password_reset_throttle').where('user_id', userId).first()).toBeUndefined();

    // …and the victim can still get a code. (Fresh IP budget: those 15 probes were sent from this
    // same address and would otherwise 429 the victim's own request — which is the per-IP limiter
    // doing its job, but it is not what this case is about.)
    rateStore.resetAll();
    resetMailbox();
    await askForCode(EMAIL);
    expect(lastSentMail()?.to).toBe(EMAIL);
  });

  it('cuts off one address after ten attempts, whatever it asks about', async () => {
    // The outer envelope. It is per-IP and therefore weak on its own — anyone with a second address
    // walks around it, which is why the per-account budget above exists — but it is what stops one
    // machine grinding through the endpoint, and it is off by one config line, so it gets a test.
    for (let i = 0; i < 10; i += 1) {
      const res = await req().post('/api/v1/password-reset/request').send({ email: UNKNOWN });
      expect(res.status, `attempt ${i + 1}`).toBe(202);
    }
    const blocked = await req().post('/api/v1/password-reset/request').send({ email: UNKNOWN });
    expect(blocked.status).toBe(429);
    // And it covers the confirm endpoint from the same budget, not a separate one.
    const confirm = await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp: '123456', newPassword: NEW_PASSWORD });
    expect(confirm.status).toBe(429);
  });

  // ─── One canonical spelling per path ───

  it('refuses every alternative spelling that would route past a guard', async () => {
    // Express matches the RAW pathname; Better Auth re-parses with the WHATWG parser, which decodes
    // %2e and collapses dot segments. That disagreement made `/api/v1/auth/%2e/email-otp/
    // reset-password` reach the plugin's own reset handler — no throttle, no limiter, no ten-char
    // floor, no audit row — and `/api/v1/password-reset//confirm` reach the controller with the
    // rate limiter never invoked. Both are refused now, before anything routes on them.
    //
    // Sent over a raw socket, NOT through supertest: supertest normalises the path in the client,
    // so `%2e` never left the process and the request that arrived was the already-safe one. A test
    // written on top of it reported 404 and proved nothing. An attacker uses curl --path-as-is.
    const ambiguous = [
      '/api/v1/auth/%2e/email-otp/reset-password',
      '/api/v1/auth/%2e/sign-in/email-otp',
      '/api/v1/auth/./email-otp/reset-password',
      '/api/v1/auth/x/../email-otp/reset-password',
      '/api/v1/auth/email-otp%2freset-password',
      '/api/v1/password-reset//confirm',
      '/api/v1/password-reset//request',
    ];
    for (const path of ambiguous) {
      const res = await rawPost(path, { email: EMAIL, otp: '123456', password: NEW_PASSWORD });
      expect(res.status, path).toBe(400);
      expect(res.body, path).toBe('{"error":"Bad request"}');
    }
    // The ordinary spellings still work exactly as before — including a trailing slash and the root.
    expect((await req().get('/api/v1/password-reset/capabilities')).status).toBe(200);
    expect((await req().get('/api/v1/health')).status).toBe(200);
    expect((await rawPost('/api/v1/password-reset/request/', { email: UNKNOWN })).status).not.toBe(400);
  });

  // ─── The hole the plugin opens ───

  it('does not let a stranger create an account', async () => {
    const before = Number((await db('users').count('* as c').first() as any).c);
    const res = await req().post('/api/v1/auth/sign-in/email-otp')
      .send({ email: 'intruder@nowhere.test', otp: '123456' });
    expect(res.status).toBe(404);

    // The 404 above is the app's own middleware, so on its own it proves nothing about the plugin's
    // configuration — delete `disableSignUp` and it would still pass. Call the handler DIRECTLY,
    // past every route guard, so the assertion rests on the config rather than on the mounting.
    const { auth } = await import('../config/auth');
    await expect(
      auth.api.signInEmailOTP({ body: { email: 'intruder@nowhere.test', otp: '123456' } }),
    ).rejects.toThrow();

    expect(Number((await db('users').count('* as c').first() as any).c)).toBe(before);
    expect(await db('users').whereRaw("lower(email) = 'intruder@nowhere.test'").first()).toBeUndefined();
  });

  it('does not expose the plugin routes that bypass our throttle and audit', async () => {
    for (const path of ['/api/v1/auth/email-otp/send-verification-otp',
      '/api/v1/auth/email-otp/reset-password',
      '/api/v1/auth/forget-password/email-otp']) {
      const res = await req().post(path).send({ email: EMAIL, otp: '123456', password: NEW_PASSWORD });
      expect(res.status, path).toBe(404);
    }
  });

  it('leaves an audit trail with the code and the password stripped out of it', async () => {
    // These endpoints sit under /api/v1, so auditLogger snapshots their request bodies — an
    // unauthenticated credential change SHOULD leave a trail. What must not be in it is the code or
    // the new password, and the only thing standing between them and `audit_logs.metadata` is that
    // the redactor matches 'otp' and 'password' as substrings of the field names. Rename either
    // field in the controller and this fails, which is the entire point of the test.
    await askForCode(EMAIL);
    const otp = mailedOtp();
    await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp, newPassword: NEW_PASSWORD });

    // record() is fired from res.on('finish') and not awaited, so the row lands after the response.
    let row: any;
    for (let i = 0; i < 20 && !row; i += 1) {
      row = await db('audit_logs').where('path', 'password-reset/confirm').orderBy('id', 'desc').first();
      if (!row) await new Promise((r) => setTimeout(r, 50));
    }
    expect(row, 'no audit row was written for the confirmation').toBeTruthy();

    const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    expect(meta.otp).toBe('[redacted]');
    expect(meta.newPassword).toBe('[redacted]');
    expect(JSON.stringify(row)).not.toContain(otp);
    expect(JSON.stringify(row)).not.toContain(NEW_PASSWORD);

    await askForCode(EMAIL);
    await req().post('/api/v1/password-reset/confirm')
      .send({ email: EMAIL, otp: mailedOtp(), newPassword: OLD_PASSWORD });
  });
});
