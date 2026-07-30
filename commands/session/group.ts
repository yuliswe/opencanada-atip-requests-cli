import { Command as CommandGroup } from 'commander';
import { createKeepaliveCommand } from '@/commands/session/keepalive/command';
import { createRefreshCommand } from '@/commands/session/refresh/command';

export function createSessionCommandGroup(): CommandGroup {
  const sessionCommand = new CommandGroup('session').description(
    'Manage the captured ATIP Online session (keep it alive)'
  );
  sessionCommand.addCommand(createRefreshCommand());
  sessionCommand.addCommand(createKeepaliveCommand());
  return sessionCommand;
}
