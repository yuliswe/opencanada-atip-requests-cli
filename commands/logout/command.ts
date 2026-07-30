import { Command } from 'commander';
import { clearSession, loadSession } from '@/utils/session';
import { print } from '@/utils/render';

export function createLogoutCommand(): Command {
  return new Command('logout')
    .description('Delete the stored ATIP Online session from this machine')
    .action(() => {
      if (!loadSession()) {
        print('No stored session.');
        return;
      }
      clearSession();
      print('Session removed.');
    });
}
