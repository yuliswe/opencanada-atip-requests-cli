import { Command } from 'commander';
import { print } from '@/utils/render';
import { loadStore } from '@/utils/store';

const SUMMARY_MAX_LENGTH = 60;

export function createRequestRefsCommand(): Command {
  return new Command('request-refs')
    .description('List tracked request refs, one "ref:summary" line per ref')
    .action(() => {
      try {
        const { requests } = loadStore();
        for (const request of requests) {
          const summary = request.summary
            .replace(/\s+/g, ' ')
            .slice(0, SUMMARY_MAX_LENGTH);
          print(`${request.id}:${summary}`);
          if (request.requestNumber) {
            print(`${request.requestNumber}:${summary}`);
          }
        }
      } catch {
        // Tab completion must never surface errors; printing nothing simply
        // means no suggestions.
      }
    });
}
