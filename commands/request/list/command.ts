import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import { print, printErr, printLongOutput } from '@/utils/render';
import { isTrackedStatus, loadStore, TRACKED_STATUSES } from '@/utils/store';

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

export function createListCommand(): Command {
  return new Command('list')
    .description('List locally tracked ATIP requests')
    .option(
      '--status <status>',
      `Filter by status (${TRACKED_STATUSES.join(', ')})`
    )
    .option('--json', 'Print raw JSON records')
    .action((options: { json?: boolean; status?: string }) => {
      if (options.status && !isTrackedStatus(options.status)) {
        printErr(
          `Invalid status "${options.status}". ` +
            `Valid statuses: ${TRACKED_STATUSES.join(', ')}`
        );
        process.exit(1);
      }
      const store = loadStore();
      const requests = store.requests.filter(
        request => !options.status || request.status === options.status
      );
      if (options.json) {
        print(JSON.stringify(requests, null, 2));
        return;
      }
      if (requests.length === 0) {
        print(
          'No tracked requests yet. Start one with "atip request new" or ' +
            '"atip informal <request-number>".'
        );
        return;
      }
      const lines = [
        chalk.dim(
          `${'ID'.padEnd(4)} ${'KIND'.padEnd(9)} ${'NUMBER'.padEnd(
            18
          )} ${'INSTITUTION'.padEnd(28)} ${'STATUS'.padEnd(13)} UPDATED`
        ),
      ];
      for (const request of requests) {
        lines.push(
          `${String(request.id).padEnd(4)} ${request.kind.padEnd(9)} ` +
            `${(request.requestNumber ?? '-').padEnd(18)} ` +
            `${truncate(request.institution ?? '-', 27).padEnd(28)} ` +
            `${request.status.padEnd(13)} ${request.updatedAt.slice(0, 10)}`
        );
      }
      printLongOutput(lines);
    });
}
