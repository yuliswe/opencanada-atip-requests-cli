import { Command } from 'commander';
import { print } from '@/utils/render';
import { ATIP_ONLINE_DASHBOARD_URL } from '@/utils/urls';

export function createOpenCommand(): Command {
  return new Command('open')
    .description(
      'Open ATIP Online in a Chrome window signed in with the stored session'
    )
    .option(
      '--url <url>',
      'Portal page to open instead of the dashboard',
      ATIP_ONLINE_DASHBOARD_URL
    )
    .action(async (options: { url: string }) => {
      // playwright-core is only loaded on demand so other commands do not pay
      // its startup cost.
      const { openPortalWindow } = await import('@/utils/portalBrowser');
      await openPortalWindow({
        url: options.url,
        onStatus: message => print(message),
      });
    });
}
