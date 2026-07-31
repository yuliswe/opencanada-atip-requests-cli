import { Command as CommandGroup } from 'commander';
import { createOrgSlugsCommand } from '@/commands/complete/org-slugs/command';
import { createRequestRefsCommand } from '@/commands/complete/request-refs/command';

export function createCompleteCommandGroup(): CommandGroup {
  const complete = new CommandGroup('complete').description(
    'Output completion candidates for shell scripts (internal)'
  );
  // Hidden from help and from the generated completions: it exists only for
  // _completion.zsh to call on each tab press.
  (complete as CommandGroup & { _hidden?: boolean })._hidden = true;
  complete.addCommand(createOrgSlugsCommand());
  complete.addCommand(createRequestRefsCommand());
  return complete;
}
