import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import { browserStep } from '@/utils/browser';
import {
  englishTitle,
  findAtiSummariesByRequestNumber,
  formatDisposition,
} from '@/utils/ckan';
import { confirm } from '@/utils/prompt';
import { formatYearMonth, print, printErr, wrapText } from '@/utils/render';
import { addRequest } from '@/utils/store';
import { buildAtiSearchPageUrl } from '@/utils/urls';

export function createInformalCommand(): Command {
  return new Command('informal')
    .description(
      'Request a free copy of the records of a completed ATI request ' +
        '(informal request)'
    )
    .argument('<request-number>', 'Request number found with "atip search"')
    .option(
      '-o, --org <orgSlug>',
      'Institution slug, needed when several institutions share the number'
    )
    .option('--no-track', 'Do not record the request in the local tracker')
    .action(
      async (
        requestNumber: string,
        options: { track: boolean; org?: string }
      ) => {
        const records = await findAtiSummariesByRequestNumber({
          requestNumber,
          org: options.org,
        });
        if (records.length === 0) {
          printErr(
            `No completed ATI summary found for "${requestNumber}". ` +
              'Look the number up first with "atip search".'
          );
          process.exit(1);
        }
        const orgSlugs = [...new Set(records.map(record => record.owner_org))];
        if (orgSlugs.length > 1) {
          printErr(
            `Request number ${requestNumber} exists in several institutions. ` +
              'Rerun with -o <orgSlug>:'
          );
          for (const record of records) {
            printErr(
              `  -o ${record.owner_org}  (${englishTitle(
                record.owner_org_title
              )})`
            );
          }
          process.exit(1);
        }

        const [record] = records;
        const institution = englishTitle(record.owner_org_title);
        const summary =
          record.summary_en ?? record.summary_fr ?? '(no summary)';
        print(`${chalk.bold(record.request_number)}  ${institution}`);
        print(
          chalk.dim(
            `${formatYearMonth(record.year, record.month)} · ` +
              `${formatDisposition(record.disposition)} · ` +
              `${record.pages ?? 0} pages`
          )
        );
        for (const line of wrapText(summary, { width: 76, indent: '  ' })) {
          print(line);
        }

        // The "Request a copy of records" form is browser-only, embedded on
        // the record page of the ATI search.
        const searchUrl = buildAtiSearchPageUrl(record.request_number);
        await browserStep({
          title: 'Complete the informal request in the browser',
          url: searchUrl,
          steps: [
            `Open the result for ${record.request_number} (${institution})`,
            'Scroll to the "Request a copy of records" form below the summary',
            'Fill in your contact details and submit the form',
          ],
        });

        const submitted = await confirm('Did you submit the informal request?');
        if (!submitted) {
          print('Nothing recorded.');
          return;
        }
        if (!options.track) {
          return;
        }
        const tracked = addRequest({
          kind: 'informal',
          requestNumber: record.request_number,
          institution,
          summary,
          status: 'submitted',
          url: searchUrl,
        });
        print(
          `Tracked as #${tracked.id}. See it with "atip request list" and ` +
            `update it with "atip request update ${tracked.id}".`
        );
      }
    );
}
