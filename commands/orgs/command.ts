import chalk from 'chalk';
import { Command } from 'commander';
import { englishTitle, listOrganizations } from '@/utils/ckan';
import { print, printLongOutput } from '@/utils/render';

export function createOrgsCommand(): Command {
  return new Command('orgs')
    .description(
      'List institution slugs accepted by "atip search -o" and ' +
        '"atip informal -o"'
    )
    .argument('[pattern]', 'Case-insensitive filter on slug or title')
    .action(async (pattern: string | undefined) => {
      const organizations = await listOrganizations();
      const wanted = pattern?.toLowerCase();
      const matches = organizations.filter(
        org =>
          !wanted ||
          org.name.toLowerCase().includes(wanted) ||
          org.title.toLowerCase().includes(wanted)
      );
      if (matches.length === 0) {
        print(`No institutions match "${pattern}".`);
        return;
      }
      const lines = matches.map(
        org => `${chalk.bold(org.name.padEnd(32))} ${englishTitle(org.title)}`
      );
      lines.push('');
      lines.push(chalk.dim(`${matches.length} institution(s).`));
      printLongOutput(lines);
    });
}
