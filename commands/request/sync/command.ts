import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import {
  fetchRequestList,
  fetchRequestListDiagnostics,
  type PortalRequestSummary,
} from '@/utils/portal';
import { print, printErr, printLongOutput } from '@/utils/render';
import { loadSession } from '@/utils/session';
import { upsertPortalRequest } from '@/utils/store';

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

function summaryLine(summary: PortalRequestSummary, marker: string): string {
  const messages =
    summary.newMessages > 0
      ? chalk.yellow(`${summary.newMessages} new`)
      : chalk.dim('—');
  return (
    `${marker} ${summary.referenceNumber.padEnd(16)} ` +
    `${truncate(summary.label, 30).padEnd(31)} ` +
    `${truncate(summary.institution, 22).padEnd(23)} ` +
    `${summary.status.padEnd(13)} ${summary.dateSubmitted.padEnd(11)} ${messages}`
  );
}

export function createSyncCommand(): Command {
  return new Command('sync')
    .description(
      'Fetch your live requests from ATIP Online and update the local tracker'
    )
    .option('--json', 'Print the parsed requests as JSON instead of syncing')
    .option(
      '--raw',
      'Print the raw portal response and request diagnostics (for debugging)'
    )
    .action(async (options: { json?: boolean; raw?: boolean }) => {
      const session = loadSession();
      if (!session) {
        printErr('No ATIP Online session. Run "atip login" first.');
        process.exit(1);
      }

      if (options.raw) {
        const diag = await fetchRequestListDiagnostics(session);
        print(
          chalk.dim(
            `token-get-url=${diag.tokenGetUrl}\n` +
              `antiforgery-token=${diag.tokenFound ? 'found' : 'NOT found'} ` +
              `status=${diag.status} content-type=${diag.contentType} ` +
              `final-url=${diag.finalUrl}`
          )
        );
        print('');
        print(diag.body);
        return;
      }

      if (options.json) {
        const requests = await fetchRequestList(session);
        print(JSON.stringify(requests, null, 2));
        return;
      }

      const summaries = await fetchRequestList(session);
      if (summaries.length === 0) {
        print(
          'No requests found on ATIP Online. If you have open requests, the ' +
            'portal list format may have changed — try "atip request sync --json".'
        );
        return;
      }

      let created = 0;
      let changed = 0;
      const lines: string[] = [];
      for (const summary of summaries) {
        const result = upsertPortalRequest({
          portalId: summary.id,
          referenceNumber: summary.referenceNumber,
          institution: summary.institution,
          summary: summary.label,
          portalStatus: summary.status,
          url: summary.detailUrl,
        });
        const marker = result.created
          ? chalk.green('+')
          : result.statusChanged
            ? chalk.yellow('~')
            : ' ';
        if (result.created) {
          created += 1;
        } else if (result.statusChanged) {
          changed += 1;
        }
        lines.push(summaryLine(summary, marker));
      }
      lines.push('');
      lines.push(
        chalk.dim(
          `${summaries.length} request(s) on the portal · ` +
            `${created} new, ${changed} status change(s). ` +
            `Legend: ${chalk.green('+')} new  ${chalk.yellow('~')} changed.`
        )
      );
      printLongOutput(lines);
    });
}
