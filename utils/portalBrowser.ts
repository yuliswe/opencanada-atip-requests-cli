import { type BrowserContext } from 'patchright-core';
import { launchPortalProfileContext } from '@/utils/playwrightLogin';
import {
  hasAuthCookie,
  isSessionExpired,
  loadSession,
  sessionCookieToCookiePairs,
} from '@/utils/session';
import { ATIP_ONLINE_ORIGIN } from '@/utils/urls';

// Signs the launched browser context into ATIP Online using the stored session
// captured by "atip login". The stored session is the credential the CLI keeps
// current (login and "session refresh" write it), so it authoritatively wins
// over whatever sits in the persistent profile: a dead .AspNetCore.Cookies left
// in the profile from an earlier login would otherwise be reused and bounce the
// window straight to sign-in. The origin's cookies are cleared before the
// stored ones are injected, so no stale auth-cookie chunk survives when the
// stored session splits into fewer chunks than the profile happens to hold.
// Falls back to a still-signed-in profile jar (e.g. a session captured with
// "atip login --paste" that was never written to disk) when no usable stored
// session exists.
export async function signInPortalContext(
  context: BrowserContext,
  onStatus: (message: string) => void
): Promise<void> {
  const session = loadSession();
  if (session?.cookie && !isSessionExpired(session)) {
    const { hostname } = new URL(ATIP_ONLINE_ORIGIN);
    await context.clearCookies({ domain: hostname });
    await context.addCookies(
      sessionCookieToCookiePairs(session.cookie).map(pair => ({
        ...pair,
        domain: hostname,
        path: '/',
      }))
    );
    onStatus('Signed the browser in with the stored session.');
    return;
  }
  const profileCookies = await context.cookies(ATIP_ONLINE_ORIGIN);
  if (hasAuthCookie(profileCookies)) {
    onStatus('Using the session already signed in to this browser profile.');
    return;
  }
  onStatus(
    'No usable stored session; the portal may ask you to sign in. ' +
      'Run "atip login" to capture one.'
  );
}

// Opens a visible Chrome window on the CLI's persistent profile — the same
// profile "atip login" signs into — so the portal opens already authenticated.
// Blocks until the user closes the window, since closing the context closes the
// browser.
export async function openPortalWindow(params: {
  url: string;
  onStatus?: (message: string) => void;
}): Promise<void> {
  const onStatus = params.onStatus ?? (() => undefined);
  const context = await launchPortalProfileContext();
  try {
    await signInPortalContext(context, onStatus);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(params.url, { waitUntil: 'domcontentloaded' });
    onStatus('Close the browser window when you are done.');
    await new Promise<void>(resolve => {
      context.once('close', () => resolve());
    });
  } finally {
    // Closing an already-closed context is a no-op, so this only matters on
    // the error paths before the close-wait.
    await context.close();
  }
}
