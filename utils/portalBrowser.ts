import { launchPortalProfileContext } from '@/utils/playwrightLogin';
import {
  hasAuthCookie,
  isSessionExpired,
  loadSession,
  sessionCookieToCookiePairs,
} from '@/utils/session';
import { ATIP_ONLINE_ORIGIN } from '@/utils/urls';

// Opens a visible Chrome window on the CLI's persistent profile — the same
// profile "atip login" signs into — so the portal opens already authenticated.
// The profile's own cookie jar is preferred because the portal may have
// re-minted the auth cookie since the session file was captured; the stored
// session is injected only when the jar has no auth cookie (e.g. a session
// captured with "atip login --paste" on a fresh profile). Blocks until the
// user closes the window, since closing the context closes the browser.
export async function openPortalWindow(params: {
  url: string;
  onStatus?: (message: string) => void;
}): Promise<void> {
  const onStatus = params.onStatus ?? (() => undefined);
  const context = await launchPortalProfileContext();
  try {
    const profileCookies = await context.cookies(ATIP_ONLINE_ORIGIN);
    if (!hasAuthCookie(profileCookies)) {
      const session = loadSession();
      if (session?.cookie && !isSessionExpired(session)) {
        const { hostname } = new URL(ATIP_ONLINE_ORIGIN);
        await context.addCookies(
          sessionCookieToCookiePairs(session.cookie).map(pair => ({
            ...pair,
            domain: hostname,
            path: '/',
          }))
        );
        onStatus('Signed the browser in with the stored session.');
      } else {
        onStatus(
          'No usable stored session; the portal may ask you to sign in. ' +
            'Run "atip login" to capture one.'
        );
      }
    }
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
