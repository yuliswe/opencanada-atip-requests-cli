import chalk from 'chalk';
import { Command } from 'commander';
import process from 'node:process';
import { refreshSession, SessionExpiredError } from '@/utils/portal';
import { print, printErr } from '@/utils/render';
import { loadSession, saveSession } from '@/utils/session';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export function createKeepaliveCommand(): Command {
  return new Command('keepalive')
    .description(
      'Refresh the ATIP Online session on a loop so it does not time out ' +
        '(runs until you press Ctrl-C or the session can no longer be renewed)'
    )
    .option(
      '-i, --interval-minutes <n>',
      'Minutes between refreshes (portal times out at ~20)',
      '15'
    )
    .action(async (options: { intervalMinutes: string }) => {
      const minutes = Number.parseInt(options.intervalMinutes, 10);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes >= 20) {
        printErr(
          'Interval must be a whole number of minutes between 1 and 19.'
        );
        process.exit(1);
      }
      if (!loadSession()) {
        printErr('No ATIP Online session. Run "atip login" first.');
        process.exit(1);
      }
      print(
        chalk.dim(
          `Keeping the session alive every ${minutes} min. Press Ctrl-C to stop.`
        )
      );
      // Each cycle reloads the session so an out-of-band `atip login` is picked
      // up, and the caught SessionExpiredError ends the loop cleanly.
      for (;;) {
        const session = loadSession();
        if (!session) {
          printErr('Session file disappeared. Stopping.');
          process.exit(1);
        }
        try {
          const refreshed = await refreshSession(session);
          saveSession(refreshed);
          print(chalk.dim(`${timestamp()}  refreshed`));
        } catch (e) {
          if (e instanceof SessionExpiredError) {
            printErr(
              `${timestamp()}  session expired — run "atip login" to renew.`
            );
            process.exit(1);
          }
          throw e;
        }
        await sleep(minutes * 60_000);
      }
    });
}
