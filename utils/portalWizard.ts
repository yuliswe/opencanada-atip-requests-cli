import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import {
  applySetCookies,
  extractAntiforgeryToken,
  parseCookieHeader,
  serializeCookieJar,
  SessionExpiredError,
} from '@/utils/portal';
import { type PortalSession } from '@/utils/session';
import { ATIP_ONLINE_ORIGIN } from '@/utils/urls';

// "None of the above - I am looking for general government records" on the
// wizard's Welcome step: an Access to Information Act request carrying the $5
// fee. The other SubjectId values are personal-information streams that are
// handled differently and free, so "request new" (a formal ATI request) always
// starts from this option.
export const GENERAL_RECORDS_SUBJECT_ID = '1';

export type PortalInstitution = {
  // Numeric id used in /en/Organisation/Select/{id}.
  id: string;
  name: string;
  acronym: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// The institution chooser (/en/Organisation) renders all institutions into one
// server-side <table>; the client only paginates it. Each data row links to
// /en/Organisation/Select/{id} with the institution name, and a later cell
// carries the acronym, so both are read for resolving a user-supplied name.
export function parsePortalInstitutions(html: string): PortalInstitution[] {
  const institutions: PortalInstitution[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const inner = row[1];
    const link = inner.match(
      /<a\b[^>]*class=["']orgSelector["'][^>]*href=["']\/en\/Organisation\/Select\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!link) {
      continue;
    }
    const cells = [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      stripHtml(c[1])
    );
    institutions.push({
      id: link[1],
      name: stripHtml(link[2]),
      // Columns: name, online (Yes/No), request count, acronym, view.
      acronym: cells[3] ?? '',
    });
  }
  return institutions;
}

export class InstitutionNotFoundError extends Error {
  constructor(query: string, candidates: PortalInstitution[]) {
    const hint =
      candidates.length > 0
        ? ` Did you mean: ${candidates
            .slice(0, 8)
            .map(c => `${c.name} (${c.acronym})`)
            .join(', ')}?`
        : '';
    super(`No single institution matches "${query}".${hint}`);
    this.name = 'InstitutionNotFoundError';
  }
}

// Resolves a user-supplied institution to exactly one portal institution.
// Matching order: exact numeric id, exact acronym, exact name, then a unique
// case-insensitive substring of name or acronym. Anything that matches zero or
// more than one institution throws with the near-misses as a hint.
export function resolvePortalInstitution(
  institutions: PortalInstitution[],
  query: string
): PortalInstitution {
  const q = query.trim().toLowerCase();
  const byId = institutions.find(i => i.id === query.trim());
  if (byId) {
    return byId;
  }
  const exact = institutions.filter(
    i => i.acronym.toLowerCase() === q || i.name.toLowerCase() === q
  );
  if (exact.length === 1) {
    return exact[0];
  }
  const partial = institutions.filter(
    i => i.name.toLowerCase().includes(q) || i.acronym.toLowerCase().includes(q)
  );
  if (partial.length === 1) {
    return partial[0];
  }
  throw new InstitutionNotFoundError(
    query,
    partial.length > 0 ? partial : exact
  );
}

type WizardStep = {
  status: number;
  url: string;
  html: string;
};

// A wizard step's antiforgery token, the POST target of its "Next" button
// (ASP.NET renders it as the button's formaction, not the form's action), and
// every hidden field to echo back on the next POST.
export function parseWizardStep(html: string): {
  token: string | null;
  nextAction: string | null;
  hiddens: Record<string, string>;
} {
  const buttons = [
    ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi),
  ].map(b => ({
    attrs: b[1],
    label: stripHtml(b[2]),
    formaction: (b[1].match(/\bformaction=["']([^"']*)["']/i) || [])[1],
  }));
  const next =
    buttons.find(b => b.formaction && /next/i.test(`${b.attrs} ${b.label}`)) ??
    buttons.find(b => b.formaction);
  const hiddens: Record<string, string> = {};
  for (const input of html.matchAll(
    /<input\b[^>]*\btype=["']hidden["'][^>]*>/gi
  )) {
    const name = (input[0].match(/\bname=["']([^"']*)["']/i) || [])[1];
    if (!name || name === '__RequestVerificationToken') {
      continue;
    }
    hiddens[name] =
      (input[0].match(/\bvalue=["']([^"']*)["']/i) || [])[1] ?? '';
  }
  return {
    token: extractAntiforgeryToken(html),
    nextAction: next?.formaction ?? null,
    hiddens,
  };
}

// Drives the signed-in new-request wizard with plain authenticated requests —
// the same mechanism "request list" uses — so the CLI can prefill every step up
// to payment without a browser. Each step mints its own antiforgery cookie, so
// the jar is threaded across requests and seeded with only the auth/WAF cookies
// (a carried-over antiforgery cookie fails validation).
export class NewRequestWizard {
  private jar: Map<string, string>;

  constructor(session: PortalSession) {
    if (!session.cookie) {
      throw new Error('Session has no cookie. Run "atip login".');
    }
    this.jar = new Map();
    for (const [name, value] of parseCookieHeader(session.cookie)) {
      if (
        name.startsWith('.AspNetCore.Cookies') ||
        name === 'ATIP' ||
        name.startsWith('TS')
      ) {
        this.jar.set(name, value);
      }
    }
  }

  private assertAuthed(url: string): void {
    const path = new URL(url).pathname.toLowerCase();
    if (
      new URL(url).origin !== ATIP_ONLINE_ORIGIN ||
      path.includes('/signon') ||
      path.includes('/home/signin')
    ) {
      throw new SessionExpiredError();
    }
  }

  // Issues a request and follows redirects manually so a per-hop Set-Cookie
  // (the antiforgery cookie, re-minted session cookies) lands in the jar before
  // the next hop, which Node's cookie-less fetch would otherwise drop.
  private async request(
    pathOrUrl: string,
    init?: { method?: 'GET' | 'POST'; body?: string }
  ): Promise<WizardStep> {
    const method = init?.method ?? 'GET';
    let url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${ATIP_ONLINE_ORIGIN}${pathOrUrl}`;
    let response = await fetchWithTimeout(url, {
      method,
      headers: {
        Cookie: serializeCookieJar(this.jar),
        'User-Agent': 'atip-cli',
        ...(method === 'POST'
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      body: init?.body,
      redirect: 'manual',
    });
    applySetCookies(this.jar, response.headers.getSetCookie());
    for (let hop = 0; hop < 12; hop++) {
      const location = response.headers.get('location');
      if (!location) {
        break;
      }
      url = new URL(location, url).toString();
      this.assertAuthed(url);
      response = await fetchWithTimeout(url, {
        headers: {
          Cookie: serializeCookieJar(this.jar),
          'User-Agent': 'atip-cli',
        },
        redirect: 'manual',
      });
      applySetCookies(this.jar, response.headers.getSetCookie());
    }
    this.assertAuthed(response.url || url);
    return { status: response.status, url, html: await response.text() };
  }

  private async post(
    action: string,
    fields: Record<string, string>,
    token: string | null
  ): Promise<WizardStep> {
    const body = new URLSearchParams(fields);
    if (token) {
      body.set('__RequestVerificationToken', token);
    }
    return this.request(action, { method: 'POST', body: body.toString() });
  }

  // Fetches the institution chooser and resolves the query against it.
  async resolveInstitution(query: string): Promise<PortalInstitution> {
    const step = await this.request('/en/Organisation');
    return resolvePortalInstitution(parsePortalInstitutions(step.html), query);
  }

  // Advances Welcome (choose general records) and What-you-need (acknowledge),
  // then selects the institution, landing on the request-details form. Returns
  // the details step so the caller can prefill it (or hand it to the browser).
  async startGeneralRecordsRequest(institutionId: string): Promise<WizardStep> {
    const welcome = parseWizardStep((await this.request('/en')).html);
    if (!welcome.nextAction) {
      throw new SessionExpiredError();
    }
    const whatYouNeed = parseWizardStep(
      (
        await this.post(
          welcome.nextAction,
          { ...welcome.hiddens, SubjectId: GENERAL_RECORDS_SUBJECT_ID },
          welcome.token
        )
      ).html
    );
    if (whatYouNeed.nextAction) {
      await this.post(
        whatYouNeed.nextAction,
        { ...whatYouNeed.hiddens, Acknowledged: 'true' },
        whatYouNeed.token
      );
    }
    return this.request(`/en/Organisation/Select/${institutionId}`);
  }
}
