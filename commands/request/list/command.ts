import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import {
  fetchRequestList,
  fetchRequestListDiagnostics,
  SessionExpiredError,
} from '@/utils/portal';
import { print, printErr, printLongOutput } from '@/utils/render';
import { loadSession } from '@/utils/session';
import {
  isTrackedStatus,
  loadStore,
  TRACKED_STATUSES,
  upsertPortalRequest,
  type TrackedRequest,
} from '@/utils/store';

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

// Fetches the live request list and writes it through to the cache. Returns a
// note explaining any fall back to cache-only (no session, or an expired one)
// so the command can still show what it has.
async function refreshCache(): Promise<{ live: boolean; note: string }> {
  const session = loadSession();
  if (!session) {
    return {
      live: false,
      note: 'no session — showing cached copy; run "atip login" for live data',
    };
  }
  try {
    const summaries = await fetchRequestList(session);
    for (const summary of summaries) {
      upsertPortalRequest({
        portalId: summary.id,
        referenceNumber: summary.referenceNumber,
        institution: summary.institution,
        summary: summary.label,
        portalStatus: summary.status,
        newMessages: summary.newMessages,
        url: summary.detailUrl,
      });
    }
    return { live: true, note: '' };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return {
        live: false,
        note: 'session expired — showing cached copy; run "atip login" to refresh',
      };
    }
    throw e;
  }
}

function messagesCell(request: TrackedRequest): string {
  return request.newMessages > 0
    ? chalk.yellow(`${request.newMessages} new`)
    : chalk.dim('—');
}

function renderRow(request: TrackedRequest): string {
  const status = request.portalStatus ?? request.status;
  return (
    `${String(request.id).padEnd(4)} ` +
    `${(request.requestNumber ?? '-').padEnd(16)} ` +
    `${truncate(request.institution ?? '-', 26).padEnd(27)} ` +
    `${truncate(status, 14).padEnd(15)} ` +
    `${messagesCell(request).padEnd(14)} ${request.updatedAt.slice(0, 10)}`
  );
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description(
      'List your ATIP requests, refreshing live status from the portal and ' +
        'caching it locally (use --cached to read the cache only)'
    )
    .option('--cached', 'Read only the local cache; do not contact the portal')
    .option(
      '--status <status>',
      `Filter by status (${TRACKED_STATUSES.join(', ')})`
    )
    .option('--json', 'Print the requests as JSON')
    .option(
      '--raw',
      'Print the raw portal response and diagnostics (implies a live fetch)'
    )
    .action(
      async (options: {
        cached?: boolean;
        json?: boolean;
        raw?: boolean;
        status?: string;
      }) => {
        if (options.status && !isTrackedStatus(options.status)) {
          printErr(
            `Invalid status "${options.status}". ` +
              `Valid statuses: ${TRACKED_STATUSES.join(', ')}`
          );
          process.exit(1);
        }

        if (options.raw) {
          const session = loadSession();
          if (!session) {
            printErr('No ATIP Online session. Run "atip login" first.');
            process.exit(1);
          }
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

        let live = false;
        let note = 'cached';
        if (!options.cached) {
          const result = await refreshCache();
          ({ live } = result);
          note = result.note || 'live';
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
            `${'ID'.padEnd(4)} ${'NUMBER'.padEnd(16)} ` +
              `${'INSTITUTION'.padEnd(26)} ${'STATUS'.padEnd(14)} ` +
              `${'MESSAGES'.padEnd(9)} UPDATED`
          ),
        ];
        for (const request of requests) {
          lines.push(renderRow(request));
        }
        lines.push('');
        lines.push(
          chalk.dim(
            live
              ? `${requests.length} request(s) · refreshed live from ATIP Online`
              : `${requests.length} request(s) · ${note}`
          )
        );
        printLongOutput(lines);
      }
    );
}
