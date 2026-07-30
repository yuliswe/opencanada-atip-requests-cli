import { Command } from 'commander';
import { openInBrowser } from '@/utils/browser';
import { ATIP_ONLINE_PORTAL_URL } from '@/utils/urls';

export function createPortalCommand(): Command {
  return new Command('portal')
    .description('Open ATIP Online (atip-aiprp.tbs-sct.gc.ca) in the browser')
    .action(() => {
      openInBrowser(ATIP_ONLINE_PORTAL_URL);
    });
}
