import { Command } from 'commander';
import { TRACKED_STATUSES } from '@/utils/store';

const CLI_NAME = 'atip';

type OptionLike = {
  long?: string;
  short?: string;
  argChoices?: string[];
  required?: boolean;
  optional?: boolean;
  _hidden?: boolean;
  description?: string;
};

type ArgumentLike = {
  _name: string;
  description: string;
  required: boolean;
  variadic: boolean;
};

function isOrgSlugRelated(name: string, description: string): boolean {
  const n = name.toLowerCase();
  const d = description.toLowerCase();
  return n === 'org' || n === 'orgslug' || d.includes('institution slug');
}

function isRequestRefRelated(name: string, description: string): boolean {
  const n = name.toLowerCase();
  const d = description.toLowerCase();
  return n === 'ref' || d.includes('tracker id or request number');
}

function isTrackedStatusRelated(name: string, description: string): boolean {
  return name.toLowerCase() === 'status' && /\bstatus\b/i.test(description);
}

function getVisibleOptions(cmd: Command): OptionLike[] {
  return ([...cmd.options] as OptionLike[]).filter(o => {
    if (o._hidden) return false;
    const long = o.long?.replace(/^--/, '');
    return long !== 'help' && long !== 'version';
  });
}

function getRegisteredArguments(cmd: Command): ArgumentLike[] {
  return (cmd.registeredArguments ?? []) as unknown as ArgumentLike[];
}

function getVisibleSubcommands(cmd: Command): Command[] {
  return (cmd.commands as Command[]).filter(
    (c: Command) =>
      !(c as Command & { _hidden?: boolean })._hidden && c.name() !== 'help'
  );
}

function completerFor(name: string, description: string): string {
  if (isOrgSlugRelated(name, description)) return `_${CLI_NAME}_org_slugs`;
  if (isRequestRefRelated(name, description))
    return `_${CLI_NAME}_request_refs`;
  return '';
}

function formatOptionSpec(option: OptionLike): string {
  const { short, long } = option;
  const desc = long?.replace(/^--/, '') ?? short?.replace(/^-/, '') ?? '';

  let choices = option.argChoices;
  if (!choices && isTrackedStatusRelated(desc, option.description ?? '')) {
    choices = [...TRACKED_STATUSES];
  }
  const completer = completerFor(desc, option.description ?? '');

  let valueSuffix = '';
  if (choices?.length) {
    valueSuffix = `:${desc}:(${choices.join(' ')})`;
  } else if (option.required) {
    valueSuffix = `:${desc}:${completer}`;
  } else if (option.optional) {
    valueSuffix = `::${desc}:${completer}`;
  }

  if (short && long) {
    return `'(${short} ${long})'{${short},${long}}'[${desc}]${valueSuffix}'`;
  }

  const flag = long ?? short!;
  return `'${flag}[${desc}]${valueSuffix}'`;
}

function formatArgumentSpec(arg: ArgumentLike, position: number): string {
  const name = arg._name;
  const action = completerFor(name, arg.description);
  const colon = arg.required ? ':' : '::';
  return `'${position}${colon}${name}:${action}'`;
}

/**
 * Generates a Zsh completion function for a leaf command (one with no further
 * subcommands). Completes both positional arguments and options.
 */
function generateLeafHandler(cmd: Command, fnName: string): string {
  const opts = getVisibleOptions(cmd);
  const args = getRegisteredArguments(cmd);
  if (opts.length === 0 && args.length === 0) return '';

  const specs: string[] = [];
  args.forEach((arg, i) => specs.push(formatArgumentSpec(arg, i + 1)));
  opts.forEach(o => specs.push(formatOptionSpec(o)));

  const joined = specs.join(' \\\n    ');
  return `\
${fnName}() {
  _arguments -s -S \\
    ${joined}
}
`;
}

/**
 * Generates a Zsh completion function for a command that has subcommands.
 * Uses _arguments -C with state dispatch so $words/$line are properly shifted
 * at each nesting level.
 */
function generateBranchHandler(
  cmd: Command,
  fnName: string,
  leafFunctions: string[]
): string {
  const subs = getVisibleSubcommands(cmd);
  const subNames = subs.flatMap(c => [c.name(), ...c.aliases()]).join(' ');
  const opts = getVisibleOptions(cmd);
  const optSpecs = opts.map(o => `\\\n    ${formatOptionSpec(o)} `).join('');

  const caseBranches = subs
    .map(sub => {
      const subFnName = `${fnName}_${sub.name().replace(/-/g, '_')}`;
      const subSubs = getVisibleSubcommands(sub);
      if (subSubs.length > 0) {
        generateBranchHandler(sub, subFnName, leafFunctions);
      } else {
        const leaf = generateLeafHandler(sub, subFnName);
        if (leaf) leafFunctions.push(leaf);
      }
      const hasContent =
        subSubs.length > 0 ||
        getVisibleOptions(sub).length > 0 ||
        getRegisteredArguments(sub).length > 0;
      const body = hasContent ? `${subFnName}` : '_normal';
      const matchPattern = [sub.name(), ...sub.aliases()].join('|');
      return `    ${matchPattern}) ${body} ;;`;
    })
    .join('\n');

  const fn = `\
${fnName}() {
  local state line
  typeset -A opt_args

  _arguments -C ${optSpecs}\\
    '1:subcommand:(${subNames})' \\
    '*:: :->args'

  case $state in
    args)
      case $line[1] in
${caseBranches}
      esac
      ;;
  esac
}
`;
  leafFunctions.push(fn);
  return fn;
}

const ORG_SLUGS_HELPER = `\
_${CLI_NAME}_org_slugs() {
  local -a slugs
  slugs=(\${(f)"$(${CLI_NAME} complete org-slugs 2>/dev/null)"})
  if (( \${#slugs} )); then
    _describe 'institution slug' slugs
  fi
}
`;

const REQUEST_REFS_HELPER = `\
_${CLI_NAME}_request_refs() {
  local -a refs
  refs=(\${(f)"$(${CLI_NAME} complete request-refs 2>/dev/null)"})
  if (( \${#refs} )); then
    _describe 'tracked request' refs
  fi
}
`;

export function generateZshCompletion(program: Command): string {
  const leafFunctions: string[] = [];
  const mainFnName = `_${CLI_NAME}`;

  generateBranchHandler(program, mainFnName, leafFunctions);

  return `\
# Zsh completion for ${CLI_NAME}. Generated by "${CLI_NAME} completion zsh".
# Install: add "source /path/to/_completion.zsh" to ~/.zshrc, after compinit.

${ORG_SLUGS_HELPER}
${REQUEST_REFS_HELPER}
${leafFunctions.join('\n')}
compdef ${mainFnName} ${CLI_NAME}
`;
}
