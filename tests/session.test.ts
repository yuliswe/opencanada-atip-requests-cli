import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import {
  clearSession,
  cookiesToSession,
  getSessionFilePath,
  hasUsableSession,
  isSessionExpired,
  loadSession,
  saveSession,
  type PortalSession,
} from '@/utils/session';

function sampleSession(overrides: Partial<PortalSession> = {}): PortalSession {
  return {
    cookie: '.AspNetCore.Cookies=abc123',
    headers: {},
    expiresAt: null,
    capturedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('session', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atip-session-test-'));
    process.env.ATIP_CLI_HOME = tempHome;
  });

  afterEach(() => {
    delete process.env.ATIP_CLI_HOME;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('stores the session under ATIP_CLI_HOME', () => {
    expect(getSessionFilePath()).toBe(path.join(tempHome, 'session.json'));
  });

  it('returns null when no session is stored', () => {
    expect(loadSession()).toBeNull();
    expect(hasUsableSession()).toBe(false);
  });

  it('round-trips a saved session', () => {
    const session = sampleSession({ headers: { Authorization: 'Bearer x' } });
    saveSession(session);
    expect(loadSession()).toEqual(session);
  });

  it('writes the session file owner-read/write only', () => {
    saveSession(sampleSession());
    const mode = fs.statSync(getSessionFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('honours ATIP_CLI_SESSION_MODE and relaxes the directory to match', () => {
    process.env.ATIP_CLI_SESSION_MODE = '644';
    saveSession(sampleSession());
    const fileMode = fs.statSync(getSessionFilePath()).mode & 0o777;
    const dirMode = fs.statSync(tempHome).mode & 0o777;
    delete process.env.ATIP_CLI_SESSION_MODE;
    expect(fileMode).toBe(0o644);
    expect(dirMode).toBe(0o755);
  });

  it('clears the session', () => {
    saveSession(sampleSession());
    clearSession();
    expect(loadSession()).toBeNull();
    expect(() => clearSession()).not.toThrow();
  });

  it('treats a session with no expiry as non-expiring', () => {
    expect(isSessionExpired(sampleSession({ expiresAt: null }))).toBe(false);
  });

  it('honours expiry with a safety skew', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    const expiresSoon = sampleSession({
      expiresAt: '2026-07-30T12:00:30.000Z',
    });
    const expiresLater = sampleSession({
      expiresAt: '2026-07-30T12:05:00.000Z',
    });
    expect(isSessionExpired(expiresSoon, now)).toBe(true);
    expect(isSessionExpired(expiresLater, now)).toBe(false);
  });

  it('reports usable only for a stored, unexpired session', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    expect(hasUsableSession(now)).toBe(false);
    saveSession(sampleSession({ expiresAt: '2026-07-30T13:00:00.000Z' }));
    expect(hasUsableSession(now)).toBe(true);
    saveSession(sampleSession({ expiresAt: '2026-07-30T11:00:00.000Z' }));
    expect(hasUsableSession(now)).toBe(false);
  });
});

describe('cookiesToSession', () => {
  it('joins cookies into a header and skips empty values', () => {
    const session = cookiesToSession(
      [
        { name: '.AspNetCore.Cookies', value: 'abc', expires: -1 },
        { name: 'TSxyz', value: '', expires: -1 },
        { name: '.AspNetCore.Antiforgery.k', value: 'def', expires: -1 },
      ],
      '2026-07-30T00:00:00.000Z'
    );
    expect(session.cookie).toBe(
      '.AspNetCore.Cookies=abc; .AspNetCore.Antiforgery.k=def'
    );
    expect(session.capturedAt).toBe('2026-07-30T00:00:00.000Z');
  });

  it('takes the earliest auth-cookie expiry, ignoring session cookies', () => {
    const session = cookiesToSession(
      [
        { name: '.AspNetCore.CookiesC1', value: 'a', expires: 1_800_000_100 },
        { name: '.AspNetCore.CookiesC2', value: 'b', expires: 1_800_000_050 },
        { name: 'TSlb', value: 'c', expires: 1_700_000_000 },
      ],
      '2026-07-30T00:00:00.000Z'
    );
    expect(session.expiresAt).toBe(
      new Date(1_800_000_050 * 1000).toISOString()
    );
  });

  it('leaves expiry null when auth cookies are session-scoped', () => {
    const session = cookiesToSession(
      [{ name: '.AspNetCore.Cookies', value: 'a', expires: -1 }],
      '2026-07-30T00:00:00.000Z'
    );
    expect(session.expiresAt).toBeNull();
  });
});
