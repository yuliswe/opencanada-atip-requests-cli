import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import { openInBrowser } from '@/utils/browser';
import { verifySession } from '@/utils/portal';
import { askSecret, confirm } from '@/utils/prompt';
import { print, printErr } from '@/utils/render';
import {
  hasUsableSession,
  loadSession,
  saveSession,
  type PortalSession,
} from '@/utils/session';
import { ATIP_ONLINE_PORTAL_URL } from '@/utils/urls';

// Sanity check: the portal auth cookie is an ASP.NET Core cookie, so a valid
// paste contains at least one cookie pair and, in practice, the auth cookie.
function looksLikeCookieHeader(value: string): boolean {
  return /(^|;\s*)[^=;\s]+=/.test(value) && value.includes('AspNetCore');
}

function reportExpiry(session: PortalSession): void {
  if (session.expiresAt) {
    print(chalk.dim(`Session valid until ${session.expiresAt}.`));
  } else {
    print(
      chalk.dim(
        'Session has no fixed expiry; the CLI will prompt you to log in ' +
          'again when the portal stops accepting it.'
      )
    );
  }
}

async function captureViaBrowser(): Promise<void> {
  // playwright-core is only loaded on demand so other commands do not pay its
  // startup cost.
  const { captureSessionViaBrowser } = await import('@/utils/playwrightLogin');
  print(chalk.bold('Opening Chrome for you to sign in…'));
  const session = await captureSessionViaBrowser({
    onStatus: message => print(message),
  });
  await verifySession(session);
  saveSession(session);
  print(
    chalk.green('Session captured and verified. ') + 'Try "atip request sync".'
  );
  reportExpiry(session);
}

async function captureViaPaste(): Promise<void> {
  print(chalk.bold('Capture your ATIP Online session by pasting the cookie'));
  print(
    'The session cookie is HttpOnly, so it cannot be read by a script. ' +
      'Copy it from your browser once:'
  );
  print('');
  print('  1. Sign in to ATIP Online in the browser (opening now).');
  print('  2. Open DevTools (F12) and go to the Network tab.');
  print(
    '  3. Reload the page, click the top request to ' +
      chalk.cyan('atip-aiprp.tbs-sct.gc.ca') +
      '.'
  );
  print(
    '  4. Under Request Headers, copy the entire ' +
      chalk.cyan('Cookie:') +
      ' value.'
  );
  print('  5. Paste it below (input is hidden).');
  print('');
  openInBrowser(ATIP_ONLINE_PORTAL_URL);

  const pasted = (await askSecret('Cookie header')).trim();
  if (!pasted) {
    printErr('Nothing pasted.');
    process.exit(1);
  }
  // Tolerate a pasted "Cookie: <value>" prefix from the header view.
  const cookie = pasted.replace(/^cookie:\s*/i, '').trim();
  if (!looksLikeCookieHeader(cookie)) {
    printErr(
      'That does not look like the ATIP Online Cookie header ' +
        '(expected an .AspNetCore.* cookie). Nothing saved.'
    );
    process.exit(1);
  }

  const session: PortalSession = {
    cookie,
    headers: {},
    // A pasted cookie exposes no reliable client-side expiry; expiry is
    // detected at request time by the sign-in redirect instead.
    expiresAt: null,
    capturedAt: new Date().toISOString(),
  };
  await verifySession(session);
  saveSession(session);
  print(
    chalk.green('Session captured and verified. ') + 'Try "atip request sync".'
  );
}

export function createLoginCommand(): Command {
  return new Command('login')
    .description(
      'Capture your signed-in ATIP Online session so the CLI can read your ' +
        'requests. The portal has no API and no automatable login, so you ' +
        'sign in in a browser once and the CLI keeps the session.'
    )
    .option(
      '--paste',
      'Skip the automated browser and paste the session cookie from DevTools instead'
    )
    .option(
      '--check',
      'Only check whether the stored session still works, without capturing a new one'
    )
    .action(async (options: { paste?: boolean; check?: boolean }) => {
      if (options.check) {
        const session = loadSession();
        if (!session) {
          print('No stored session. Run "atip login" to capture one.');
          return;
        }
        await verifySession(session);
        print(chalk.green('Session is valid.'));
        reportExpiry(session);
        return;
      }

      if (hasUsableSession()) {
        const replace = await confirm(
          'A session is already stored. Replace it?',
          { defaultYes: false }
        );
        if (!replace) {
          print('Keeping the existing session.');
          return;
        }
      }

      if (options.paste) {
        await captureViaPaste();
        return;
      }
      await captureViaBrowser();
    });
}
