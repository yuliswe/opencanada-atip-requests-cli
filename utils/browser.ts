import { spawnSync } from 'node:child_process';
import process from 'node:process';
import chalk from 'chalk';
import { ask } from '@/utils/prompt';
import { print } from '@/utils/render';

export function openInBrowser(url: string): void {
  const { platform } = process;
  const opener =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const result = spawnSync(opener, args, { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    print(chalk.yellow('Could not launch a browser automatically.'));
  }
  print(`Browser URL: ${chalk.cyan(url)}`);
}

// Some steps (portal sign-in, payment, web forms) cannot be automated over an
// API. This helper hands those steps to the user in a browser and blocks the
// CLI until they report back, so the command can continue afterwards.
export async function browserStep(params: {
  steps: string[];
  title: string;
  url: string;
}): Promise<void> {
  const { title, url, steps } = params;
  print();
  print(chalk.bold(title));
  steps.forEach((step, index) => print(`  ${index + 1}. ${step}`));
  print();
  openInBrowser(url);
  await ask(chalk.bold('Press Enter here when you are done in the browser'));
}
