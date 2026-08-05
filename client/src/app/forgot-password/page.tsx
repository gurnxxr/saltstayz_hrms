'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import api from '@/lib/api';
import PasswordInput from '@/components/ui/PasswordInput';

/**
 * Password reset for someone who cannot sign in.
 *
 * Deliberately NOT wrapped in <AppShell> — that wrapper is what requires a session, so a page
 * without it is a public one. This is the whole point here; anything that bounced to /login would
 * make the feature unreachable by the only people who need it.
 *
 * The server tells us nothing about the address we asked about, and this screen must not invent
 * more than it was told. "If that email address has an account…" is the same sentence whether the
 * address is registered or not, and showing anything more definite would turn the screen into a way
 * of checking who works here.
 */

/** Mirrors COOLDOWN_SECONDS in passwordResetThrottle.service — asking sooner is silently ignored. */
const RESEND_AFTER_SECONDS = 60;
/** Mirrors the confirm schema's floor. Checked here only so the message can be a helpful one. */
const MIN_PASSWORD_LENGTH = 10;

type Step = 'email' | 'code';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/password-reset/request', { email });
      setNotice(data.message);
      setStep('code');
      setCooldown(RESEND_AFTER_SECONDS);
    } catch (err: unknown) {
      // 429 is the only thing worth distinguishing: it is about this browser, not about the account.
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(status === 429
        ? 'Too many attempts from here. Please try again in 15 minutes.'
        : 'Could not send a code. Check the address and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/password-reset/confirm', { email, otp, newPassword });
      // Every session was revoked server-side, so there is nothing to clean up here.
      router.push('/login?reset=1');
    } catch (err: unknown) {
      const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
      if (res?.status === 429) {
        setError('Too many attempts from here. Please try again in 15 minutes.');
      } else if (res?.status === 400) {
        // Only a 400 means the server actually judged the code. Clear it so the field does not sit
        // there looking accepted.
        setError(res?.data?.error || 'That code is not valid or has expired. Request a new one.');
        setOtp('');
      } else {
        // A dropped connection or a 500 says nothing about the code, and the code is still live.
        // Wiping it here pushed people into requesting another — of which they get three in fifteen
        // minutes — for a failure that was never theirs.
        setError('Could not reach the server. Your code is still valid — please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const field = 'w-full px-4 py-2.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition bg-white text-foreground';

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-white text-2xl font-bold mb-4">
              S
            </div>
            <h1 className="text-2xl font-bold text-foreground">Reset your password</h1>
            <p className="text-secondary mt-1">
              {step === 'email'
                ? 'We will email you a six-digit code.'
                : 'Enter the code we emailed you, then choose a new password.'}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 text-danger text-sm p-3 rounded-lg border border-red-200 mb-5">
              {error}
            </div>
          )}

          {step === 'email' ? (
            <form onSubmit={sendCode} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@saltstayz.com"
                  required
                  autoComplete="username"
                  className={field}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-primary text-white font-medium rounded-lg hover:bg-primary-hover transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {loading ? 'Sending...' : 'Send code'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitReset} className="space-y-5">
              {notice && (
                <div className="bg-muted text-secondary text-sm p-3 rounded-lg border border-border flex gap-2.5">
                  <MailCheck size={16} className="shrink-0 mt-0.5" />
                  <span>{notice} It expires in 10 minutes.</span>
                </div>
              )}

              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-foreground mb-1.5">
                  Six-digit code
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  required
                  className={`${field} tracking-[0.5em] text-center font-mono`}
                />
              </div>

              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-1.5">
                  New password
                </label>
                <PasswordInput
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={field}
                />
                <p className="text-xs text-secondary mt-1.5">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                  Confirm new password
                </label>
                <PasswordInput
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={field}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-primary text-white font-medium rounded-lg hover:bg-primary-hover transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {loading ? 'Updating...' : 'Reset password'}
              </button>

              <button
                type="button"
                onClick={() => sendCode()}
                disabled={loading || cooldown > 0}
                className="w-full text-sm text-secondary hover:text-foreground transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cooldown > 0 ? `Send another code in ${cooldown}s` : 'Send another code'}
              </button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-border text-center">
            <Link
              href="/login"
              className="text-sm text-secondary hover:text-foreground transition inline-flex items-center gap-1.5"
            >
              <ArrowLeft size={14} />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
