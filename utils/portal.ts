import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import { type PortalSession } from '@/utils/session';
import { ATIP_ONLINE_ORIGIN } from '@/utils/urls';

// Raised when a portal request comes back unauthenticated — the captured
// cookie has expired or been revoked. The CLI boundary catches this and tells
// the user to run `atip login` again.
export class SessionExpiredError extends Error {
  constructor() {
    super('Your ATIP Online session has expired. Run "atip login" again.');
    this.name = 'SessionExpiredError';
  }
}

export type PortalRequestSummary = {
  // Internal numeric id used in detail URLs (/YourRequestDetails/Index/{id}).
  id: string;
  // The portal's own request reference (e.g. EA2026_0160384), shown as
  // "Request ID" in the UI.
  referenceNumber: string;
  label: string;
  institution: string;
  type: string;
  dateSubmitted: string;
  status: string;
  newMessages: number;
  detailUrl: string;
};

function cookieHeader(session: PortalSession): string {
  if (!session.cookie) {
    throw new Error('Session has no cookie. Run "atip login".');
  }
  return session.cookie;
}

function baseHeaders(session: PortalSession): Record<string, string> {
  return {
    Cookie: cookieHeader(session),
    'User-Agent': 'atip-cli',
    ...session.headers,
  };
}

// A request that lands anywhere other than the portal origin, or on the
// sign-in page, means the session no longer authenticates us.
function assertStillAuthed(response: Response): void {
  const finalUrl = new URL(response.url);
  const signedOut =
    finalUrl.origin !== ATIP_ONLINE_ORIGIN ||
    finalUrl.pathname.toLowerCase().includes('/home/signin') ||
    finalUrl.pathname.toLowerCase().includes('/home/login');
  if (signedOut || response.status === 401) {
    throw new SessionExpiredError();
  }
}

async function portalGet(
  session: PortalSession,
  path: string
): Promise<Response> {
  const response = await fetchWithTimeout(`${ATIP_ONLINE_ORIGIN}${path}`, {
    headers: baseHeaders(session),
  });
  assertStillAuthed(response);
  return response;
}

// Confirms the captured session actually authenticates, used right after
// login and as `atip login --check`. Throws SessionExpiredError otherwise.
export async function verifySession(session: PortalSession): Promise<void> {
  const response = await portalGet(session, '/en/Dashboard');
  const finalUrl = new URL(response.url);
  if (!finalUrl.pathname.toLowerCase().includes('/dashboard')) {
    throw new SessionExpiredError();
  }
}

// The portal's inactivity window (from the WET session-timeout widget config:
// inactivity 1200000ms). A successful refresh resets the idle timer, so the
// session is good for roughly another window.
export const SESSION_WINDOW_MS = 20 * 60_000;

// Pings /en/Session/Refresh — the same keep-alive the portal UI calls to stop
// the 20-minute inactivity logout. It answers `true` and reissues the session
// cookies, which are merged back in so the stored session slides forward.
// Throws SessionExpiredError once the session can no longer be kept alive.
export async function refreshSession(
  session: PortalSession,
  now: Date = new Date()
): Promise<PortalSession> {
  const response = await fetchWithTimeout(
    `${ATIP_ONLINE_ORIGIN}/en/Session/Refresh`,
    {
      headers: {
        ...baseHeaders(session),
        'X-Requested-With': 'XMLHttpRequest',
      },
    }
  );
  assertStillAuthed(response);
  const body = (await response.text()).trim().toLowerCase();
  if (!response.ok || body !== 'true') {
    throw new SessionExpiredError();
  }
  const jar = parseCookieHeader(session.cookie ?? '');
  applySetCookies(jar, response.headers.getSetCookie());
  return {
    ...session,
    cookie: serializeCookieJar(jar),
    expiresAt: new Date(now.getTime() + SESSION_WINDOW_MS).toISOString(),
  };
}

const ANTIFORGERY_FIELD = '__RequestVerificationToken';

export function parseCookieHeader(header: string): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  return jar;
}

// Applies Set-Cookie headers onto a cookie jar, taking only the name=value
// prefix of each (attributes like Path/HttpOnly are irrelevant when we replay
// the cookie to the same origin).
export function applySetCookies(
  jar: Map<string, string>,
  setCookies: string[]
): void {
  for (const setCookie of setCookies) {
    const [pair] = setCookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) {
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

export function serializeCookieJar(jar: Map<string, string>): string {
  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

// Order-independent extraction of the antiforgery token from a hidden input,
// tolerating any attribute order and single or double quotes.
export function extractAntiforgeryToken(html: string): string | null {
  const tag = html.match(
    /<input\b[^>]*\bname=["']__RequestVerificationToken["'][^>]*>/i
  );
  if (!tag) {
    return null;
  }
  const value = tag[0].match(/\bvalue=["']([^"']*)["']/i);
  return value ? value[1] : null;
}

// The antiforgery token is rendered into a hidden field on the list page and
// must be echoed back on the POST. Critically, the GET that renders it also
// sets the paired antiforgery cookie via Set-Cookie; because Node's fetch keeps
// no cookie jar between calls, that cookie is forwarded here explicitly.
// Without it the token has no matching cookie and the portal answers the POST
// with an HTML error page instead of JSON.
async function fetchAntiforgeryContext(
  session: PortalSession
): Promise<{ token: string | null; cookie: string; tokenGetUrl: string }> {
  const response = await portalGet(session, '/en/YourRequestList');
  const html = await response.text();
  const jar = parseCookieHeader(session.cookie ?? '');
  applySetCookies(jar, response.headers.getSetCookie());
  return {
    token: extractAntiforgeryToken(html),
    cookie: serializeCookieJar(jar),
    tokenGetUrl: response.url,
  };
}

// The token GET should stay on the request-list page. If the portal bounced it
// elsewhere on-origin (e.g. /Email/CheckEmail when email verification is
// pending, or an account page), the session is not fully usable and there is
// no token to send — surface that instead of POSTing into a doomed request.
function assertOnRequestList(tokenGetUrl: string): void {
  if (
    !new URL(tokenGetUrl).pathname.toLowerCase().includes('yourrequestlist')
  ) {
    throw new Error(
      `ATIP Online redirected to ${new URL(tokenGetUrl).pathname} instead of ` +
        'your request list. Your session is signed in but not fully active ' +
        '(often a pending email verification). Complete any prompts on the ' +
        'portal, then run "atip login" again.'
    );
  }
}

function stripHtml(cell: string): string {
  return cell
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

type TableCell = { attrs: string; inner: string };

function parseCells(rowHtml: string): TableCell[] {
  const cells: TableCell[] = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rowHtml)) !== null) {
    cells.push({ attrs: match[1], inner: match[2] });
  }
  return cells;
}

// GetMyRequestsList returns a rendered HTML <table> fragment (the custom
// ATIP-Search.js injects it), not JSON. Each data row is a
// <tr class="request_row"> whose first cell links to the detail page and
// carries the reference number; status lives in a request-status-* class and
// the date is a bare yyyy-mm-dd cell, so those are read semantically rather
// than by fragile column index.
export function parseRequestListRows(html: string): PortalRequestSummary[] {
  const rows: PortalRequestSummary[] = [];
  const rowRe = /<tr\b[^>]*\brequest_row\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = parseCells(rowMatch[1]);
    if (cells.length === 0) {
      continue;
    }
    const link = cells[0].inner.match(
      /href="\/en\/YourRequestDetails\/Index\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!link) {
      continue;
    }
    const id = link[1];
    const typeCell = cells[3]?.inner ?? '';
    const typeTitle = typeCell.match(/title="([^"]+)"/i);
    const statusCell = cells.find(c => /request-status-/.test(c.attrs));
    const dateCell = cells.find(c =>
      /^\d{4}-\d{2}-\d{2}$/.test(stripHtml(c.inner))
    );
    const newMessages = Number.parseInt(
      stripHtml(cells[cells.length - 1]?.inner ?? ''),
      10
    );
    rows.push({
      id,
      referenceNumber: stripHtml(link[2]),
      label: stripHtml(cells[1]?.inner ?? ''),
      institution: stripHtml(cells[2]?.inner ?? ''),
      type: typeTitle ? typeTitle[1] : stripHtml(typeCell),
      dateSubmitted: dateCell ? stripHtml(dateCell.inner) : '',
      status: stripHtml(statusCell?.inner ?? cells[6]?.inner ?? ''),
      newMessages: Number.isFinite(newMessages) ? newMessages : 0,
      detailUrl: `${ATIP_ONLINE_ORIGIN}/en/YourRequestDetails/Index/${id}`,
    });
  }
  return rows;
}

const GET_MY_REQUESTS_PATH = '/en/YourRequestList/GetMyRequestsList';

async function postRequestList(
  session: PortalSession,
  context: { token: string | null; cookie: string }
): Promise<Response> {
  const { token, cookie } = context;
  const body = new URLSearchParams({
    draw: '1',
    start: '0',
    length: '100',
    'search[value]': '',
    'order[0][column]': '0',
    'order[0][dir]': 'asc',
  });
  if (token) {
    body.set(ANTIFORGERY_FIELD, token);
  }
  const headers: Record<string, string> = {
    ...baseHeaders(session),
    // The merged jar (session cookies plus the antiforgery cookie freshly set
    // by the token GET) replaces the base session cookie.
    Cookie: cookie,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (token) {
    headers.RequestVerificationToken = token;
  }
  return await fetchWithTimeout(
    `${ATIP_ONLINE_ORIGIN}${GET_MY_REQUESTS_PATH}`,
    {
      method: 'POST',
      headers,
      body: body.toString(),
    }
  );
}

export type RequestListDiagnostics = {
  tokenFound: boolean;
  tokenGetUrl: string;
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
};

// Returns the raw list response without parsing, for `--json` and for
// diagnosing why the portal answered with something other than JSON (an HTML
// error or sign-in page). Does not throw on an unexpected response.
export async function fetchRequestListDiagnostics(
  session: PortalSession
): Promise<RequestListDiagnostics> {
  const context = await fetchAntiforgeryContext(session);
  const response = await postRequestList(session, context);
  return {
    tokenFound: context.token !== null,
    tokenGetUrl: context.tokenGetUrl,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type') ?? '',
    body: await response.text(),
  };
}

export async function fetchRequestListHtml(
  session: PortalSession
): Promise<string> {
  const context = await fetchAntiforgeryContext(session);
  assertOnRequestList(context.tokenGetUrl);
  const response = await postRequestList(session, context);
  assertStillAuthed(response);
  if (!response.ok) {
    throw new Error(
      `ATIP Online returned HTTP ${response.status} when listing requests.`
    );
  }
  return await response.text();
}

export async function fetchRequestList(
  session: PortalSession
): Promise<PortalRequestSummary[]> {
  return parseRequestListRows(await fetchRequestListHtml(session));
}
