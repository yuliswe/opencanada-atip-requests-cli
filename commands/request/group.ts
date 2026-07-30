import { Command as CommandGroup } from 'commander';
import { createListCommand } from '@/commands/request/list/command';
import { createNewCommand } from '@/commands/request/new/command';
import { createRemoveCommand } from '@/commands/request/remove/command';
import { createShowCommand } from '@/commands/request/show/command';
import { createStatusCommand } from '@/commands/request/status/command';
import { createSyncCommand } from '@/commands/request/sync/command';
import { createUpdateCommand } from '@/commands/request/update/command';

export function createRequestCommandGroup(): CommandGroup {
  const requestCommand = new CommandGroup('request').description(
    'Track your own ATIP requests (formal and informal)'
  );
  requestCommand.addCommand(createListCommand());
  requestCommand.addCommand(createNewCommand());
  requestCommand.addCommand(createRemoveCommand());
  requestCommand.addCommand(createShowCommand());
  requestCommand.addCommand(createStatusCommand());
  requestCommand.addCommand(createSyncCommand());
  requestCommand.addCommand(createUpdateCommand());
  return requestCommand;
}
