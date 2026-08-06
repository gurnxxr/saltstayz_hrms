import nodemailer from 'nodemailer';
import { env } from '../config/env';

/**
 * The application's only way of speaking to someone outside it.
 *
 * Until this file existed nothing here could send anything: `notification.service` writes rows for
 * the in-app bell and stops there. That was fine while every feature was something you logged in to
 * see. A password reset is not — the whole point is reaching somebody who cannot log in.
 *
 * It is deliberately a seam rather than a provider. Which service sends the mail is a decision with
 * a bill and a DNS change attached, and it should be one line of configuration rather than a
 * rewrite. `MAIL_PROVIDER=none` is the default and means nothing can be sent — the login screen
 * still offers the link, but the reset endpoints do nothing behind it.
 *
 * Two ways to send. `smtp` goes through an ordinary mailbox and is the one to reach for first: a
 * company already has Google Workspace or Microsoft 365, so it needs no new vendor, no new bill and
 * no DNS change — a host, a user and an app password. `resend` is the alternative once volume or
 * deliverability reporting justifies a dedicated sender, and it does need SPF and DKIM on the
 * sending domain.
 *
 * The Resend path is an HTTPS POST via the runtime's own `fetch`. The SMTP path is the one place
 * this file takes a dependency — `nodemailer` — because STARTTLS negotiation and SASL are not
 * things to hand-roll on the path that carries password-reset codes.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailResult {
  delivered: boolean;
  provider: string;
}

/**
 * The provider, read at CALL time rather than captured when this module loaded.
 *
 * `env.ts` snapshots process.env on import, which is right for everything else and wrong here: an
 * integration test has to be able to say "send to memory" and then import the app, and ES imports
 * are hoisted above every statement in the file, so by the time a test body runs the snapshot is
 * long taken. That is the same hoisting trap that once pointed a payroll run at the wrong database.
 * Reading it per call costs nothing and makes the seam testable without a process restart.
 *
 * The production guard still bites at boot: env.ts refuses to start if a dev provider is named.
 */
function currentProvider(): string {
  return process.env.MAIL_PROVIDER || env.MAIL_PROVIDER;
}

/**
 * The SMTP settings, read the same way and for the same reason as the provider above.
 *
 * Reading the provider live but its credentials from the snapshot would be the worst of both: a
 * test could select `smtp` and then find `isMailConfigured()` disagreeing with the settings it just
 * set, which is exactly the kind of half-truth this function exists to prevent. `env` stays the
 * fallback so a normal boot behaves identically.
 */
function smtpSettings() {
  return {
    host: process.env.SMTP_HOST ?? env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? env.SMTP_PORT),
    user: process.env.SMTP_USER ?? env.SMTP_USER,
    password: process.env.SMTP_PASSWORD ?? env.SMTP_PASSWORD,
    secure: (process.env.SMTP_SECURE ?? String(env.SMTP_SECURE)) === 'true',
  };
}

/**
 * Whether a real message can actually leave this process right now.
 *
 * This is the feature's kill switch: `passwordReset.service` checks it before generating a code and
 * before redeeming one, so with no provider the endpoints answer normally and do nothing. The reset
 * endpoints must answer identically either way, or the response becomes an oracle for whether mail
 * is working. `GET /password-reset/capabilities` reports it for operators.
 *
 * A provider named but not finished being configured counts as NOT configured. Half-set SMTP
 * settings would otherwise mean every code fails to send while the flow claims one is on its way.
 */
export function isMailConfigured(): boolean {
  const provider = currentProvider();
  if (provider === 'resend') return Boolean(env.RESEND_API_KEY);
  if (provider === 'smtp') {
    const s = smtpSettings();
    return Boolean(s.host && s.user && s.password);
  }
  return provider === 'log' || provider === 'memory';
}

// TESTS ONLY. `MAIL_PROVIDER=memory` parks the last message here so a test can read the code it
// would have sent. Nothing in the running application reads it.
let lastMessage: MailMessage | null = null;
export function lastSentMail(): MailMessage | null { return lastMessage; }
export function resetMailbox(): void { lastMessage = null; }

async function sendViaResend(msg: MailMessage): Promise<void> {
  // 10 seconds, then give up. Without a timeout a hanging provider holds the request open and the
  // user watches a spinner; the caller treats a failure as "nothing was sent", which is correct.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // The status and the provider's reason, never the recipient — this string reaches the log.
      throw new Error(`mail provider rejected the message (HTTP ${res.status})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The SMTP transport, built per send rather than held at module scope.
 *
 * Deliberate, and for the same reason `currentProvider` reads `process.env` per call: a transport
 * created when this module loaded would freeze whatever settings existed at import, and ES imports
 * are hoisted above every statement in a test file. A cached transport would also outlive a
 * credential rotation, so a password change would take a restart to notice. Connection setup is a
 * TCP handshake against a mail server that is about to do far more work than that.
 *
 * `TEST_SMTP_JSON=true` swaps in nodemailer's own jsonTransport, which serialises the message
 * instead of opening a socket. Tests only — it is the seam that lets the switch below be exercised
 * without a mail server, and nothing in the running application sets it.
 */
function smtpTransport() {
  if (process.env.TEST_SMTP_JSON === 'true') return nodemailer.createTransport({ jsonTransport: true });
  const s = smtpSettings();
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    // false on 587 is not "insecure": it means STARTTLS upgrades the connection after the greeting,
    // which is what Google Workspace and Microsoft 365 both expect. true is for implicit TLS on 465.
    secure: s.secure,
    auth: { user: s.user, pass: s.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

async function sendViaSmtp(msg: MailMessage): Promise<void> {
  const transport = smtpTransport();
  try {
    await transport.sendMail({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
  } catch (err) {
    // The provider's reason, never the recipient — this string reaches the log. Nodemailer puts the
    // address in some of its own messages, so the original is deliberately not re-thrown.
    const code = (err as { code?: string }).code;
    throw new Error(`SMTP server rejected the message${code ? ` (${code})` : ''}`);
  } finally {
    transport.close();
  }
}

/**
 * Send one message. Throws when it could not be handed over.
 *
 * Callers on the password-reset path must swallow the throw: whether the address exists, and
 * whether the provider is healthy, are both things the response must not reveal. Failing loudly
 * here and quietly there is the right split — the operator sees it in the log, the stranger at the
 * form sees the same 202 either way.
 */
export async function sendMail(msg: MailMessage): Promise<MailResult> {
  switch (currentProvider()) {
    case 'resend':
      if (!env.RESEND_API_KEY) throw new Error('MAIL_PROVIDER=resend but RESEND_API_KEY is empty');
      await sendViaResend(msg);
      return { delivered: true, provider: 'resend' };

    case 'smtp':
      if (!isMailConfigured()) throw new Error('MAIL_PROVIDER=smtp but SMTP_HOST, SMTP_USER or SMTP_PASSWORD is empty');
      await sendViaSmtp(msg);
      return { delivered: true, provider: 'smtp' };

    case 'log':
      // Development only — env.ts refuses this in production. It prints the body, code and all,
      // because the entire point is to walk the flow locally without a provider.
      console.log(`\n─── mail (dev) ───\nto: ${msg.to}\nsubject: ${msg.subject}\n\n${msg.text}\n──────────────────\n`);
      return { delivered: true, provider: 'log' };

    case 'memory':
      lastMessage = msg;
      return { delivered: true, provider: 'memory' };

    default:
      throw new Error('No mail provider is configured (MAIL_PROVIDER=none)');
  }
}
