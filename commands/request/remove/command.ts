import { Command } from 'commander';
import { confirm } from '@/utils/prompt';
import { print } from '@/utils/render';
import { loadStore, removeRequest, requireRequest } from '@/utils/store';

export function createRemoveCommand(): Command {
  return new Command('remove')
    .description('Remove a request from the local tracker')
    .argument('<ref>', 'Tracker ID or request number')
    .action(async (ref: string) => {
      const request = requireRequest(loadStore(), ref);
      const confirmed = await confirm(
        `Remove #${request.id} (${
          request.requestNumber ?? request.summary
        }) from the tracker?`,
        { defaultYes: false }
      );
      if (!confirmed) {
        print('Nothing removed.');
        return;
      }
      removeRequest(ref);
      print(`Removed #${request.id}.`);
    });
}
