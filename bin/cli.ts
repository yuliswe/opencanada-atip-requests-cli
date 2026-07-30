#!/usr/bin/env npx tsx

import { Command } from 'commander';
import process from 'node:process';
import { createInformalCommand } from '@/commands/informal/command';
import { createLoginCommand } from '@/commands/login/command';
import { createLogoutCommand } from '@/commands/logout/command';
import { createOrgsCommand } from '@/commands/orgs/command';
import { createPortalCommandGroup } from '@/commands/portal/group';
import { createRequestCommandGroup } from '@/commands/request/group';
import { createSearchCommand } from '@/commands/search/command';
import { createSessionCommandGroup } from '@/commands/session/group';
import { printErr } from '@/utils/render';

const program = new Command();

program
  .name('atip')
  .description(
    'Manage Canadian access-to-information (ATIP) requests: search published ' +
      'summaries through the open.canada.ca API, and hand browser-only ' +
      'portal steps (sign-in, payment, forms) to the user before continuing.'
  )
  .version('0.1.0');

program.addCommand(createInformalCommand());
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createOrgsCommand());
program.addCommand(createPortalCommandGroup());
program.addCommand(createRequestCommandGroup());
program.addCommand(createSearchCommand());
program.addCommand(createSessionCommandGroup());

void (async () => {
  try {
    await program.parseAsync();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Network failures from fetch bury the useful detail in `cause`.
    const cause =
      e instanceof Error && e.cause instanceof Error
        ? ` (${e.cause.message})`
        : '';
    printErr(`${msg}${cause}`);
    process.exit(1);
  }
  process.exit(0);
})();
