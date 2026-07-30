import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import {
  englishTitle,
  formatDisposition,
  searchAtiSummaries,
} from '@/utils/ckan';
import {
  formatYearMonth,
  print,
  printErr,
  printLongOutput,
  wrapText,
} from '@/utils/render';

type SearchOptions = {
  fr?: boolean;
  json?: boolean;
  limit: string;
  month?: string;
  offset?: string;
  org?: string;
  year?: string;
};

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    printErr(`Invalid ${label}: ${value}`);
    process.exit(1);
  }
  return parsed;
}

export function createSearchCommand(): Command {
  return new Command('search')
    .description(
      'Search summaries of completed ATI requests published on open.canada.ca'
    )
    .argument('[keywords...]', 'Full-text keywords (topic, request number, …)')
    .option('-o, --org <orgSlug>', 'Institution slug (see "atip orgs")')
    .option('-y, --year <year>', 'Year the summary was published')
    .option('-m, --month <month>', 'Month the summary was published (1-12)')
    .option('-l, --limit <n>', 'Maximum number of results', '25')
    .option('--offset <n>', 'Skip the first n results (pagination)')
    .option('--json', 'Print raw JSON records')
    .option('--fr', 'Show French summaries')
    .action(async (keywords: string[], options: SearchOptions) => {
      const query = keywords.join(' ').trim();
      if (!query && !options.org && !options.year) {
        printErr(
          'Provide keywords or at least one of --org/--year. ' +
            'Example: atip search immigration backlog -o cic'
        );
        process.exit(1);
      }
      const result = await searchAtiSummaries({
        query: query || undefined,
        org: options.org,
        year: options.year ? parsePositiveInt(options.year, 'year') : undefined,
        month: options.month
          ? parsePositiveInt(options.month, 'month')
          : undefined,
        limit: parsePositiveInt(options.limit, 'limit'),
        offset: options.offset
          ? parsePositiveInt(options.offset, 'offset')
          : undefined,
      });

      if (options.json) {
        print(JSON.stringify(result.records, null, 2));
        return;
      }

      if (result.records.length === 0) {
        print('No matching summaries found.');
        return;
      }

      const lines: string[] = [];
      result.records.forEach((record, index) => {
        const summary =
          (options.fr ? record.summary_fr : record.summary_en) ??
          record.summary_en ??
          record.summary_fr ??
          '(no summary)';
        lines.push(
          `${chalk.bold(record.request_number)}  ${chalk.green(
            englishTitle(record.owner_org_title)
          )} ${chalk.dim(`(${record.owner_org})`)}`
        );
        lines.push(
          chalk.dim(
            `  ${formatYearMonth(record.year, record.month)} · ` +
              `${formatDisposition(record.disposition)} · ` +
              `${record.pages ?? 0} pages`
          )
        );
        lines.push(...wrapText(summary, { width: 76, indent: '  ' }));
        if (index < result.records.length - 1) {
          lines.push('');
        }
      });
      lines.push('');
      lines.push(
        chalk.dim(
          `Showing ${result.records.length} of ${result.total} matching ` +
            'summaries. Request free copies of records with ' +
            '"atip informal <request-number> -o <orgSlug>".'
        )
      );
      printLongOutput(lines);
    });
}
