import { Command } from 'commander';
import { browserStep } from '@/utils/browser';
import { ask, askChoice } from '@/utils/prompt';
import { print } from '@/utils/render';
import {
  isTrackedStatus,
  loadStore,
  requireRequest,
  TRACKED_STATUSES,
  updateRequest,
} from '@/utils/store';
import { ATIP_ONLINE_PORTAL_URL } from '@/utils/urls';

const UNCHANGED_CHOICE = 'unchanged';

export function createStatusCommand(): Command {
  return new Command('status')
    .description(
      'Check the status of a request on the portal and record what you see'
    )
    .argument('<ref>', 'Tracker ID or request number')
    .action(async (ref: string) => {
      const request = requireRequest(loadStore(), ref);
      // Status tracking on the portal requires signing in, which the CLI
      // cannot automate, so the user reads the status in the browser and
      // reports it back here.
      await browserStep({
        title: `Check the status of ${
          request.requestNumber ?? `tracked request #${request.id}`
        }`,
        url: request.url ?? ATIP_ONLINE_PORTAL_URL,
        steps: [
          'Sign in with Sign-In Canada / CanadaLogin',
          'Open "My requests"',
          `Find ${request.requestNumber ?? 'your request'} and open it`,
          'Check the current status, correspondence, and released records',
        ],
      });
      const choice = await askChoice('What is the status now?', [
        UNCHANGED_CHOICE,
        ...TRACKED_STATUSES,
      ]);
      const note = await ask('Optional note (press Enter to skip)');
      if (choice === UNCHANGED_CHOICE && !note) {
        print('Nothing recorded.');
        return;
      }
      const updated = updateRequest({
        ref,
        status: isTrackedStatus(choice) ? choice : undefined,
        note: note || undefined,
      });
      print(`Updated #${updated.id} (status: ${updated.status}).`);
    });
}
