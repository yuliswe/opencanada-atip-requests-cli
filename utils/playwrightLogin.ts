import * as path from 'node:path';
import { chromium } from 'playwright-core';
import {
  cookiesToSession,
  getAtipHome,
  type PortalSession,
} from '@/utils/session';
import { ATIP_ONLINE_ORIGIN, ATIP_ONLINE_PORTAL_URL } from '@/utils/urls';

// A persistent profile lets a later run reuse the still-live Sign-In Canada
// session to re-mint the portal cookie without re-entering credentials, which
// is the only form of "renewal" possible here (the portal issues no refresh
// token). Kept separate from the user's day-to-day Chrome profile.
export function getBrowserProfileDir(): string {
  return path.join(getAtipHome(), 'chrome-profile');
}

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The auth cookie is only present once the OIDC round trip completes, so its
// appearance is a reliable, page-agnostic sign-in signal.
function hasAuthCookie(cookies: { name: string }[]): boolean {
  return cookies.some(c => c.name.startsWith('.AspNetCore.Cookies'));
}

// Drives the user's own Chrome (no browser download) through an interactive
// sign-in, then reads the cookie jar — including the HttpOnly auth cookie that
// page JavaScript cannot see. Must run on a machine with a display; it opens a
// visible window the user signs into. Detection polls the context cookie jar
// rather than a DOM selector, so it does not depend on which page or tab the
// user lands on after sign-in.
export async function captureSessionViaBrowser(options?: {
  onStatus?: (message: string) => void;
}): Promise<PortalSession> {
  const onStatus = options?.onStatus ?? (() => undefined);
  const context = await chromium.launchPersistentContext(
    getBrowserProfileDir(),
    { headless: false, channel: 'chrome', viewport: null }
  );
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(ATIP_ONLINE_PORTAL_URL, { waitUntil: 'domcontentloaded' });
    onStatus(
      'Sign in (with MFA) in the Chrome window that just opened. ' +
        'Waiting up to 5 minutes…'
    );
    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    for (;;) {
      const cookies = await context.cookies(ATIP_ONLINE_ORIGIN);
      if (hasAuthCookie(cookies)) {
        onStatus('Signed in. Capturing session…');
        return cookiesToSession(cookies, new Date().toISOString());
      }
      if (Date.now() > deadline) {
        throw new Error(
          'Timed out waiting for sign-in. If the Chrome window did not open, ' +
            'or sign-in did not complete, capture the session manually with ' +
            '"atip login --paste".'
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    await context.close();
  }
}
