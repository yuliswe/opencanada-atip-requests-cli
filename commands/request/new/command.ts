import { Command } from 'commander';
import { ask, askRequired } from '@/utils/prompt';
import { print, printErr } from '@/utils/render';
import { isSessionExpired, loadSession } from '@/utils/session';
import { addRequest } from '@/utils/store';
import {
  DELIVERY_FORMAT,
  ELIGIBILITY,
  type NewRequestInput,
} from '@/utils/portalWizard';
import { ATIP_ONLINE_DASHBOARD_URL } from '@/utils/urls';

type NewOptions = {
  institution?: string;
  label?: string;
  description?: string;
  eligibility: string;
  format: string;
};

export function createNewCommand(): Command {
  return new Command('new')
    .description(
      'Prefill a new formal ATI request in ATIP Online up to the payment ' +
        'step, then track it locally'
    )
    .option(
      '-i, --institution <name>',
      'Institution name, acronym, or portal id'
    )
    .option('-l, --label <text>', 'Short request title (max 100 characters)')
    .option(
      '-d, --description <text>',
      'What records you are requesting (max 3000 characters)'
    )
    .option(
      '--eligibility <basis>',
      `Access basis: ${Object.keys(ELIGIBILITY).join(', ')}`,
      'citizen'
    )
    .option(
      '--format <format>',
      `Delivery format: ${Object.keys(DELIVERY_FORMAT).join(', ')}`,
      'account'
    )
    .action(async (options: NewOptions) => {
      const session = loadSession();
      if (!session || isSessionExpired(session)) {
        printErr('No usable ATIP Online session. Run "atip login" first.');
        process.exit(1);
      }
      const eligibilityValue = (
        ELIGIBILITY as Record<string, string | undefined>
      )[options.eligibility];
      if (!eligibilityValue) {
        printErr(
          `Invalid --eligibility "${options.eligibility}". ` +
            `Choose one of: ${Object.keys(ELIGIBILITY).join(', ')}.`
        );
        process.exit(1);
      }
      const formatValue = (
        DELIVERY_FORMAT as Record<string, string | undefined>
      )[options.format];
      if (!formatValue) {
        printErr(
          `Invalid --format "${options.format}". ` +
            `Choose one of: ${Object.keys(DELIVERY_FORMAT).join(', ')}.`
        );
        process.exit(1);
      }

      const institution =
        options.institution ??
        (await askRequired('Institution (name, acronym, or portal id)'));
      const label =
        options.label ?? (await askRequired('Request label (short title)'));
      const description =
        options.description ??
        (await askRequired('Request description (records you want)'));

      const input: NewRequestInput = {
        institution,
        label,
        description,
        eligibilityValue,
        formatValue,
      };

      // Everything up to payment is prefilled by driving a real browser: the
      // portal has no API, its WAF blocks scripted form posts, and the details
      // form's radios only register via a real click. The window is left on the
      // review page so the user checks the prefill and pays the $5 Moneris fee
      // themselves. patchright-core is loaded on demand so other commands do not
      // pay its startup cost.
      const { launchPortalProfileContext } =
        await import('@/utils/playwrightLogin');
      const { signInPortalContext } = await import('@/utils/portalBrowser');
      const { prefillNewRequestToReview } =
        await import('@/utils/portalWizard');

      const context = await launchPortalProfileContext();
      let institutionName = institution;
      try {
        await signInPortalContext(context, message => print(message));
        const page = context.pages()[0] ?? (await context.newPage());
        print('Prefilling your request in ATIP Online…');
        const resolved = await prefillNewRequestToReview(page, input);
        institutionName = resolved.name;
        print('');
        print(
          `Prefilled a request to ${resolved.name}. Review it in the open ` +
            'window, then complete the $5 payment to submit it.'
        );
        print('The window stays open until you close it.');
        await new Promise<void>(resolve => {
          context.once('close', () => resolve());
        });
      } finally {
        await context.close();
      }

      const requestNumber = await ask(
        'Request/confirmation number (leave empty if not assigned yet)'
      );
      const tracked = addRequest({
        kind: 'formal',
        requestNumber: requestNumber || null,
        institution: institutionName,
        summary: label,
        status: 'submitted',
        url: ATIP_ONLINE_DASHBOARD_URL,
      });
      print(`Tracked as #${tracked.id}.`);
      print(
        'Reminder: ATIP Online keeps responses for only two years after ' +
          'completion, so download records as soon as they are released ' +
          '("atip request status" to check).'
      );
    });
}
