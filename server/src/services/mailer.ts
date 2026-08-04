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
 * rewrite. `MAIL_PROVIDER=none` is the default and means the feature that depends on this stays
 * switched off — see `isMailConfigured`, which the login screen asks before offering the link.
 *
 * ZERO NEW DEPENDENCIES. The Resend path is an HTTPS POST via the runtime's own `fetch`. An SMTP
 * provider would need `nodemailer`; the shape below is where it goes.
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
 * Whether a real message can actually leave this process right now.
 *
 * The reset endpoints still answer identically either way — they must, or the response becomes an
 * oracle for whether mail is working — but the login screen reads this through
 * `GET /auth-capabilities` so it can hide a button that could not do anything.
 */
export function isMailConfigured(): boolean {
  const provider = currentProvider();
  if (provider === 'resend') return Boolean(env.RESEND_API_KEY);
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
