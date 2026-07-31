import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { print } from '@/utils/render';
import { generateZshCompletion } from '@/commands/completion/zsh/generator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createZshCommand(program: Command): Command {
  return new Command('zsh')
    .description('Regenerate the Zsh completion script (_completion.zsh)')
    .action(async () => {
      const content = generateZshCompletion(program);
      const outputPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        '_completion.zsh'
      );
      await fs.writeFile(outputPath, content, 'utf-8');
      print(`Completion script written to ${outputPath}`);
    });
}
