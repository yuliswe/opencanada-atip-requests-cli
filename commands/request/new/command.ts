import { Command } from 'commander';
import { browserStep } from '@/utils/browser';
import { ask, askRequired } from '@/utils/prompt';
import { print } from '@/utils/render';
import { addRequest } from '@/utils/store';
import { ATIP_ONLINE_PORTAL_URL } from '@/utils/urls';

export function createNewCommand(): Command {
  return new Command('new')
    .description(
      'Submit a new ATIP request through ATIP Online, then track it locally'
    )
    .option('-i, --institution <name>', 'Institution the request is sent to')
    .option('-s, --summary <text>', 'Short description of the request')
    .action(async (options: { institution?: string; summary?: string }) => {
      // Submission itself is browser-only: the portal has no public API,
      // sign-in goes through Sign-In Canada / CanadaLogin, and the $5
      // application fee is collected by Moneris.
      await browserStep({
        title: 'Submit the request in ATIP Online',
        url: ATIP_ONLINE_PORTAL_URL,
        steps: [
          'Sign in (or register) with Sign-In Canada / CanadaLogin',
          'Choose "Make a request" and select the institution',
          'Describe the records you are requesting',
          'Pay the $5 application fee if you are making a formal ATI request',
          'Note the request or confirmation number shown at the end',
        ],
      });
      const requestNumber = await ask(
        'Request/confirmation number (leave empty if not assigned yet)'
      );
      const institution =
        options.institution ?? (await askRequired('Institution'));
      const summary =
        options.summary ?? (await askRequired('Short description'));
      const tracked = addRequest({
        kind: 'formal',
        requestNumber: requestNumber || null,
        institution,
        summary,
        status: 'submitted',
        url: ATIP_ONLINE_PORTAL_URL,
      });
      print(`Tracked as #${tracked.id}.`);
      print(
        'Reminder: ATIP Online keeps responses for only two years after ' +
          'completion, so download records as soon as they are released ' +
          '("atip request status" to check).'
      );
    });
}
