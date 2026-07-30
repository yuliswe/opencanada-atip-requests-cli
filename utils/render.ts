import { spawnSync } from 'node:child_process';
import { stderr, stdout } from 'node:process';
import chalk from 'chalk';
import { getEnv } from '@/utils/env';

const PAGER_THRESHOLD_LINES = 40;

export function print(text = ''): void {
  stdout.write(`${text}\n`);
}

export function printErr(text: string): void {
  stderr.write(`${chalk.red(text)}\n`);
}

export function printLongOutput(lines: string[]): void {
  const text = `${lines.join('\n')}\n`;
  if (lines.length > PAGER_THRESHOLD_LINES && stdout.isTTY) {
    const pager = getEnv().PAGER;
    const result = pager
      ? spawnSync(pager, { input: text, stdio: ['pipe', 'inherit', 'inherit'] })
      : spawnSync('less', ['-R'], {
          input: text,
          stdio: ['pipe', 'inherit', 'inherit'],
        });
    if (result.error) {
      stdout.write(text);
    }
  } else {
    stdout.write(text);
  }
}

export function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function wrapText(
  text: string,
  options: { width: number; indent: string }
): string[] {
  const { width, indent } = options;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(indent + current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(indent + current);
  }
  return lines;
}
