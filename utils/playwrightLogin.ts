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

// Every signed-in portal page renders a sign-out link; waiting for it is a
// landing-page-agnostic way to detect that the OIDC round trip completed.
const SIGNED_IN_SELECTOR = 'a[href$="/Home/Logout"], a[href*="/Home/Logout"]';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

// Drives the user's own Chrome (no browser download) through an interactive
// sign-in, then reads the cookie jar — including the HttpOnly auth cookie that
// page JavaScript cannot see. Must run on a machine with a display; it opens a
// visible window the user signs into.
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
    await page.waitForSelector(SIGNED_IN_SELECTOR, {
      timeout: SIGN_IN_TIMEOUT_MS,
    });
    onStatus('Signed in. Capturing session…');
    const cookies = await context.cookies(ATIP_ONLINE_ORIGIN);
    return cookiesToSession(cookies, new Date().toISOString());
  } finally {
    await context.close();
  }
}
