'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'>;

/**
 * A masked password field with a show/hide toggle.
 *
 * It owns the toggle and nothing else. The caller passes the same `className` it would have put on
 * a bare `<input>`; this appends the right-padding the button needs, so no call site has to know
 * how wide the button is — change the button here and every field still fits.
 *
 * `type` is deliberately not accepted. It is the one attribute this component exists to control,
 * and a caller passing `type="text"` would silently unmask the field.
 */
export default function PasswordInput({ className = '', ...props }: PasswordInputProps) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} className={`${className} pr-10`} />
      {/*
        * `type="button"` is load-bearing: three of these sit inside a <form onSubmit>, and without
        * it clicking the eye submits the form instead of revealing the password.
        *
        * Left in the tab order on purpose. Skipping it is the usual reflex, but somebody on a
        * keyboard is exactly who needs to check what they typed, so it gets a focus ring instead.
        */}
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
      >
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
