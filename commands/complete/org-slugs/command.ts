import * as path from 'node:path';
import { Command } from 'commander';
import { englishTitle, listOrganizations } from '@/utils/ckan';
import { getCompletionCacheDir, runCached } from '@/utils/completionCache';

export function createOrgSlugsCommand(): Command {
  return new Command('org-slugs')
    .description('List institution slugs, one "slug:title" line per org')
    .action(async () => {
      const cacheFile = path.join(getCompletionCacheDir(), 'org-slugs.cache');
      try {
        await runCached(cacheFile, async () => {
          const organizations = await listOrganizations();
          return organizations.map(
            org => `${org.name}:${englishTitle(org.title)}`
          );
        });
      } catch {
        // Tab completion must never surface errors; printing nothing simply
        // means no suggestions.
      }
    });
}
