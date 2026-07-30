import { Command as CommandGroup } from 'commander';
import { createOpenCommand } from '@/commands/portal/open/command';

export function createPortalCommandGroup(): CommandGroup {
  const portalCommand = new CommandGroup('portal').description(
    'ATIP Online (atip-aiprp.tbs-sct.gc.ca) helpers'
  );
  portalCommand.addCommand(createOpenCommand());
  return portalCommand;
}
