import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getEnv } from '@/utils/env';

// One captured ATIP Online authentication. Whatever the portal turns out to
// use (an HttpOnly session cookie, a bearer token, or both), it is normalized
// into cookies + headers so the portal client can attach them to plain fetch
// calls without caring how they were obtained.
export type PortalSession = {
  // Serialized "name=value; name2=value2" cookie header, if the portal
  // authenticates by cookie.
  cookie: string | null;
  // Extra headers to send on every authenticated request (e.g. a bearer
  // token or an anti-forgery header), if the portal authenticates that way.
  headers: Record<string, string>;
  // Best-effort absolute expiry (ISO 8601) derived at capture time from the
  // shortest-lived auth cookie/token. Null when unknown.
  expiresAt: string | null;
  capturedAt: string;
};

export function getSessionFilePath(): string {
  return path.join(getAtipHome(), 'session.json');
}

export function getAtipHome(): string {
  return getEnv().ATIP_CLI_HOME ?? path.join(os.homedir(), '.atip-cli');
}

// The subset of a captured browser cookie the session needs. Structurally
// compatible with Playwright's Cookie type, kept local so this module (and its
// tests) do not depend on Playwright.
export type CapturedCookie = {
  name: string;
  value: string;
  expires: number;
};

// Builds a stored session from a captured cookie jar. expiresAt is the
// earliest expiry among the ASP.NET auth cookies; session cookies report a
// negative expiry and are ignored, leaving expiresAt null so expiry is
// detected at request time by the sign-in redirect instead.
export function cookiesToSession(
  cookies: CapturedCookie[],
  capturedAt: string
): PortalSession {
  const cookie = cookies
    .filter(c => c.value)
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  const authExpiries = cookies
    .filter(c => c.name.startsWith('.AspNetCore.Cookies') && c.expires > 0)
    .map(c => c.expires);
  const expiresAt =
    authExpiries.length > 0
      ? new Date(Math.min(...authExpiries) * 1000).toISOString()
      : null;
  return { cookie, headers: {}, expiresAt, capturedAt };
}

export function loadSession(): PortalSession | null {
  const file = getSessionFilePath();
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as PortalSession;
}

// The session grants access to the user's ATIP account, so it defaults to
// owner-read/write only (0600), the same convention as SSH keys and
// ~/.aws/credentials. ATIP_CLI_SESSION_MODE overrides it (octal, e.g. "644")
// for setups where another local user — such as a sandboxed agent — must read
// the file; loosening it exposes a live credential, so it is opt-in.
export function getSessionFileMode(): number {
  const raw = getEnv().ATIP_CLI_SESSION_MODE;
  if (!raw) {
    return 0o600;
  }
  const parsed = Number.parseInt(raw, 8);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 0o777) {
    throw new Error(
      `Invalid ATIP_CLI_SESSION_MODE "${raw}" (expected an octal mode like 600 or 644).`
    );
  }
  return parsed;
}

export function saveSession(session: PortalSession): void {
  const file = getSessionFilePath();
  const fileMode = getSessionFileMode();
  // The directory must be traversable by anyone allowed to read the file, so
  // its execute bits mirror the file's read bits.
  const dirMode = fileMode & 0o044 ? 0o755 : 0o700;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: dirMode });
  fs.chmodSync(path.dirname(file), dirMode);
  const tmp = `${file}.tmp`;
  // Perms are set on the fd before any content lands.
  const fd = fs.openSync(tmp, 'w', fileMode);
  try {
    fs.writeSync(fd, `${JSON.stringify(session, null, 2)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, fileMode);
  fs.renameSync(tmp, file);
}

export function clearSession(): void {
  const file = getSessionFilePath();
  if (fs.existsSync(file)) {
    fs.rmSync(file);
  }
}

// Treated as expired a minute early so a request is never fired with a
// credential that lapses in flight.
const EXPIRY_SKEW_MS = 60_000;

export function isSessionExpired(
  session: PortalSession,
  now: Date = new Date()
): boolean {
  if (!session.expiresAt) {
    return false;
  }
  return (
    new Date(session.expiresAt).getTime() - EXPIRY_SKEW_MS <= now.getTime()
  );
}

export function hasUsableSession(now: Date = new Date()): boolean {
  const session = loadSession();
  return session !== null && !isSessionExpired(session, now);
}
