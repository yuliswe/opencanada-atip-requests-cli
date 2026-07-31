import { Command } from 'commander';
import { generateZshCompletion } from '@/commands/completion/zsh/generator';
import { TRACKED_STATUSES } from '@/utils/store';

function buildProgram(): Command {
  const program = new Command('atip');

  program
    .command('search')
    .argument('[keywords...]', 'Full-text keywords')
    .option('-o, --org <orgSlug>', 'Institution slug (see "atip orgs")')
    .option('--json', 'Print raw JSON records');

  const request = new Command('request');
  request.command('show').argument('<ref>', 'Tracker ID or request number');
  request
    .command('update')
    .argument('<ref>', 'Tracker ID or request number')
    .option('--status <status>', `New status (${TRACKED_STATUSES.join(', ')})`);
  request.command('list').alias('ls').option('--json', 'Print JSON');
  program.addCommand(request);

  const hidden = new Command('complete');
  (hidden as Command & { _hidden?: boolean })._hidden = true;
  program.addCommand(hidden);

  program.command('logout');

  return program;
}

describe('generateZshCompletion', () => {
  const script = generateZshCompletion(buildProgram());

  it('registers the completion for the atip command', () => {
    expect(script).toContain('compdef _atip atip');
    expect(script).toContain("'1:subcommand:(search request logout)'");
  });

  it('omits hidden commands and the implicit help command', () => {
    expect(script).not.toContain('_atip_complete');
    expect(script).not.toContain('help)');
  });

  it('wires org-slug options to the dynamic helper', () => {
    expect(script).toContain('atip complete org-slugs');
    expect(script).toContain(
      "'(-o --org)'{-o,--org}'[org]:org:_atip_org_slugs'"
    );
  });

  it('wires ref positionals to the dynamic helper', () => {
    expect(script).toContain('atip complete request-refs');
    expect(script).toContain("'1:ref:_atip_request_refs'");
  });

  it('inlines tracked statuses as static choices for --status', () => {
    expect(script).toContain(
      `'--status[status]:status:(${TRACKED_STATUSES.join(' ')})'`
    );
  });

  it('dispatches aliases through the same handler as the command', () => {
    expect(script).toContain('list|ls) _atip_request_list ;;');
    expect(script).toContain("'1:subcommand:(show update list ls)'");
  });
});
