import { Command } from 'commander';
import process from 'node:process';
import { print, printErr } from '@/utils/render';
import {
  isTrackedStatus,
  TRACKED_STATUSES,
  updateRequest,
} from '@/utils/store';

type UpdateOptions = {
  institution?: string;
  note?: string;
  number?: string;
  status?: string;
  summary?: string;
};

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update a tracked request (status, number, notes, …)')
    .argument('<ref>', 'Tracker ID or request number')
    .option('--status <status>', `New status (${TRACKED_STATUSES.join(', ')})`)
    .option('--number <requestNumber>', 'Set the portal request number')
    .option('--institution <name>', 'Set the institution')
    .option('--summary <text>', 'Set the summary')
    .option('--note <text>', 'Append a timestamped note')
    .action((ref: string, options: UpdateOptions) => {
      const hasChange =
        options.status !== undefined ||
        options.number !== undefined ||
        options.institution !== undefined ||
        options.summary !== undefined ||
        options.note !== undefined;
      if (!hasChange) {
        printErr(
          'Nothing to update. Pass at least one of --status, --number, ' +
            '--institution, --summary, --note.'
        );
        process.exit(1);
      }
      if (options.status && !isTrackedStatus(options.status)) {
        printErr(
          `Invalid status "${options.status}". ` +
            `Valid statuses: ${TRACKED_STATUSES.join(', ')}`
        );
        process.exit(1);
      }
      const request = updateRequest({
        ref,
        status:
          options.status && isTrackedStatus(options.status)
            ? options.status
            : undefined,
        requestNumber: options.number,
        institution: options.institution,
        summary: options.summary,
        note: options.note,
      });
      print(`Updated #${request.id} (status: ${request.status}).`);
    });
}
