import { Command as CommandGroup } from 'commander';
import { createZshCommand } from '@/commands/completion/zsh/command';

export function createCompletionCommandGroup(
  program: CommandGroup
): CommandGroup {
  const completion = new CommandGroup('completion').description(
    'Generate shell completion scripts'
  );
  completion.addCommand(createZshCommand(program));
  return completion;
}
