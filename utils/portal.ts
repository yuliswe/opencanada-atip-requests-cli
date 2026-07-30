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
  label: string;
  institution: string;
  type: string;
  dateSubmitted: string;
  status: string;
  newMessages: number;
  detailUrl: string;
};

// DataTables server-side response envelope.
type DataTablesResponse = {
  draw?: number;
  recordsTotal?: number;
  recordsFiltered?: number;
  data?: unknown[];
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

const ANTIFORGERY_FIELD = '__RequestVerificationToken';

// The antiforgery token is rendered into a hidden field on the list page and
// must be echoed back on the POST that fetches the list. It is paired with an
// HttpOnly antiforgery cookie, which is why the captured cookie jar has to
// include the whole set, not just the auth cookie.
async function fetchAntiforgeryToken(
  session: PortalSession
): Promise<string | null> {
  const response = await portalGet(session, '/en/YourRequestList');
  const html = await response.text();
  const match = html.match(
    /name="__RequestVerificationToken"[^>]*value="([^"]+)"/
  );
  return match ? match[1] : null;
}

function stripHtml(cell: string): string {
  return cell
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRow(row: unknown): string[] {
  if (Array.isArray(row)) {
    return row.map(cell => String(cell ?? ''));
  }
  if (row && typeof row === 'object') {
    return Object.values(row as Record<string, unknown>).map(cell =>
      String(cell ?? '')
    );
  }
  return [String(row ?? '')];
}

// The list arrives as DataTables rows whose exact column order was
// reverse-engineered from the rendered table (Request ID link, Label,
// Institution, Type, Date submitted, Status, New messages). Fields are pulled
// semantically where possible (id from the detail href, date by pattern) so a
// column shift does not silently corrupt the mapping; `atip request sync
// --json` exposes the raw rows if the portal ever changes shape.
function parseRow(row: unknown): PortalRequestSummary | null {
  const cells = normalizeRow(row);
  const blob = cells.join(' ');
  const idMatch = blob.match(/YourRequestDetails\/Index\/(\d+)/i);
  if (!idMatch) {
    return null;
  }
  const id = idMatch[1];
  const text = cells.map(stripHtml);
  const dateCell = text.find(c => /^\d{4}-\d{2}-\d{2}/.test(c)) ?? '';
  const newMessagesCell = text[text.length - 1] ?? '';
  const parsedCount = Number.parseInt(newMessagesCell, 10);
  return {
    id,
    label: text[1] ?? '',
    institution: text[2] ?? '',
    type: text[3] ?? '',
    dateSubmitted: dateCell.slice(0, 10),
    status: text[5] ?? '',
    newMessages: Number.isFinite(parsedCount) ? parsedCount : 0,
    detailUrl: `${ATIP_ONLINE_ORIGIN}/en/YourRequestDetails/Index/${id}`,
  };
}

const GET_MY_REQUESTS_PATH = '/en/YourRequestList/GetMyRequestsList';

async function postRequestList(
  session: PortalSession,
  token: string | null
): Promise<Response> {
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
  const token = await fetchAntiforgeryToken(session);
  const response = await postRequestList(session, token);
  return {
    tokenFound: token !== null,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type') ?? '',
    body: await response.text(),
  };
}

export async function fetchRequestListRaw(
  session: PortalSession
): Promise<DataTablesResponse> {
  const token = await fetchAntiforgeryToken(session);
  const response = await postRequestList(session, token);
  assertStillAuthed(response);
  if (!response.ok) {
    throw new Error(
      `ATIP Online returned HTTP ${response.status} when listing requests.`
    );
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as DataTablesResponse;
  } catch {
    const contentType = response.headers.get('content-type') ?? 'unknown';
    throw new Error(
      `Expected JSON from the request list but got ${contentType} ` +
        `(${text.length} bytes). The antiforgery token was ` +
        `${token ? 'found' : 'NOT found'}. ` +
        'Run "atip request sync --json" to see the raw response.'
    );
  }
}

export async function fetchRequestList(
  session: PortalSession
): Promise<PortalRequestSummary[]> {
  const raw = await fetchRequestListRaw(session);
  const rows = Array.isArray(raw.data) ? raw.data : [];
  return rows
    .map(parseRow)
    .filter((row): row is PortalRequestSummary => row !== null);
}
