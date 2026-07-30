import chalk from 'chalk';
import { Command } from 'commander';
import { print } from '@/utils/render';
import { loadStore, requireRequest } from '@/utils/store';

export function createShowCommand(): Command {
  return new Command('show')
    .description('Show one tracked request, including notes')
    .argument('<ref>', 'Tracker ID or request number')
    .action((ref: string) => {
      const request = requireRequest(loadStore(), ref);
      print(`${chalk.bold(`#${request.id}`)} (${request.kind})`);
      print(`Request number: ${request.requestNumber ?? '(not assigned)'}`);
      print(`Institution:    ${request.institution ?? '(unknown)'}`);
      print(`Status:         ${request.status}`);
      print(`Created:        ${request.createdAt}`);
      print(`Updated:        ${request.updatedAt}`);
      if (request.url) {
        print(`URL:            ${chalk.cyan(request.url)}`);
      }
      print(`Summary:        ${request.summary}`);
      if (request.notes.length > 0) {
        print();
        print(chalk.bold('Notes:'));
        for (const note of request.notes) {
          print(`  ${chalk.dim(note.at.slice(0, 16))} ${note.text}`);
        }
      }
    });
}
