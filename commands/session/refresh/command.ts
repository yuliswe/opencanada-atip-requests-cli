import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import { refreshSession } from '@/utils/portal';
import { print, printErr } from '@/utils/render';
import { loadSession, saveSession } from '@/utils/session';

export function createRefreshCommand(): Command {
  return new Command('refresh')
    .description(
      'Keep the ATIP Online session alive by pinging its refresh endpoint once'
    )
    .action(async () => {
      const session = loadSession();
      if (!session) {
        printErr('No ATIP Online session. Run "atip login" first.');
        process.exit(1);
      }
      const refreshed = await refreshSession(session);
      saveSession(refreshed);
      print(
        chalk.green('Session refreshed. ') +
          chalk.dim(`Valid until about ${refreshed.expiresAt}.`)
      );
    });
}
