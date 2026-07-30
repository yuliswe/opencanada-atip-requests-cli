import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { print } from '@/utils/render';

async function withReadline<T>(
  fn: (rl: readline.Interface) => Promise<T>
): Promise<T> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return await fn(rl);
  } finally {
    rl.close();
  }
}

export async function ask(
  question: string,
  options?: { defaultValue?: string }
): Promise<string> {
  const defaultValue = options?.defaultValue;
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = await withReadline(rl =>
    rl.question(`${question}${suffix}: `)
  );
  const trimmed = answer.trim();
  return trimmed || defaultValue || '';
}

// Reads a line without echoing it, so a pasted session credential does not
// land in the terminal scrollback or shell history. Falls back to a normal
// visible prompt when stdin is not a TTY (e.g. piped input).
export async function askSecret(question: string): Promise<string> {
  if (!stdin.isTTY) {
    return await ask(question);
  }
  stdout.write(`${question}: `);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  // Muting is done by overriding the readline output writer: it swallows the
  // echoed keystrokes but still lets readline manage line editing.
  const rlAny = rl as unknown as {
    output: { write: (chunk: string) => void };
  };
  const realWrite = rlAny.output.write.bind(rlAny.output);
  rlAny.output.write = (chunk: string) => {
    if (chunk.includes('\n') || chunk.includes('\r')) {
      realWrite(chunk);
    }
  };
  try {
    const answer = await rl.question('');
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function askRequired(question: string): Promise<string> {
  for (;;) {
    const answer = await ask(question);
    if (answer) {
      return answer;
    }
    print('A value is required.');
  }
}

export async function confirm(
  question: string,
  options?: { defaultYes?: boolean }
): Promise<boolean> {
  const defaultYes = options?.defaultYes ?? true;
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await withReadline(rl =>
    rl.question(`${question} [${hint}]: `)
  );
  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) {
    return defaultYes;
  }
  return trimmed === 'y' || trimmed === 'yes';
}

export async function askChoice(
  question: string,
  choices: readonly string[]
): Promise<string> {
  print(question);
  choices.forEach((choice, index) => print(`  ${index + 1}. ${choice}`));
  for (;;) {
    const answer = await ask(`Enter a number (1-${choices.length})`);
    const index = Number.parseInt(answer, 10);
    if (Number.isFinite(index) && index >= 1 && index <= choices.length) {
      return choices[index - 1];
    }
    const match = choices.find(
      choice => choice.toLowerCase() === answer.toLowerCase()
    );
    if (match) {
      return match;
    }
    print('Invalid choice.');
  }
}
