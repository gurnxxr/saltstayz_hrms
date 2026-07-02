import { useEffect } from 'react';

/**
 * While `hasUnsaved` is true, prompts the browser's "Leave site? Changes may not
 * be saved" dialog on refresh/close/external navigation — so pending edits in an
 * inline editor aren't lost by accident.
 */
export function useUnsavedChangesWarning(hasUnsaved: boolean) {
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // required for Chrome to show the prompt
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);
}
