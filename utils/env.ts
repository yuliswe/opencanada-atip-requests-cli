import process from 'node:process';

type EnvVars = {
  ATIP_CLI_AUTOCOMPLETE_REFRESH?: string;
  ATIP_CLI_HOME?: string;
  ATIP_CLI_SESSION_MODE?: string;
  PAGER?: string;
};

export function getEnv(): EnvVars {
  const { env } = process;
  return env as EnvVars;
}
