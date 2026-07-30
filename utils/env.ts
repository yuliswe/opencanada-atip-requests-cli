import process from 'node:process';

type EnvVars = {
  ATIP_CLI_HOME?: string;
  PAGER?: string;
};

export function getEnv(): EnvVars {
  const { env } = process;
  return env as EnvVars;
}
