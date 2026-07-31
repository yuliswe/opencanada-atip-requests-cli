import { type Page } from 'patchright-core';
import { extractAntiforgeryToken } from '@/utils/portal';
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

// Eligibility basis for accessing the records, as the details form's
// EligibilityId radio encodes it. Everyone submitting a formal ATI request
// qualifies under one of these; "citizen" is the default.
export const ELIGIBILITY = {
  citizen: '1',
  'permanent-resident': '2',
  'present-in-canada': '3',
} as const;

// How the response is delivered, as the details form's RequestFormatId radio
// encodes it. "account" (electronic, to the ATIP Online account) is the default
// and keeps everything inside the portal.
export const DELIVERY_FORMAT = {
  account: '4',
  electronic: '5',
  paper: '2',
  'in-person': '3',
} as const;

export type NewRequestInput = {
  // Institution name, acronym, or portal id — resolved against /en/Organisation.
  institution: string;
  // Short title (details form's "Request label", max 100 characters).
  label: string;
  // What records are being requested (details form's "Request description",
  // max 3000 characters).
  description: string;
  eligibilityValue?: string;
  formatValue?: string;
};

// The confirm-request review page — the last step before the Moneris payment.
// "request new" drives the wizard here and hands the browser to the user, who
// reviews the prefilled request and clicks Finish to pay.
export const REQUEST_REVIEW_PATH = '/en/RequestReview';

async function clickNext(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next' }).first().click();
  await page.waitForLoadState('domcontentloaded');
}

// Clicks Next through the remaining prefilled/optional steps (attach documents,
// contact information, both already satisfied) until the review page. Stops
// early if a Next click does not change the URL — that means a step still needs
// input the CLI did not provide, so the half-filled wizard is left on that page
// for the user to finish by hand rather than looping forever.
async function advanceToReview(page: Page): Promise<void> {
  for (let step = 0; step < 6; step++) {
    if (new RegExp(REQUEST_REVIEW_PATH, 'i').test(page.url())) {
      return;
    }
    const next = page.getByRole('button', { name: 'Next' }).first();
    if ((await next.count()) === 0) {
      return;
    }
    const before = page.url();
    await next.click();
    await page.waitForLoadState('domcontentloaded');
    if (page.url() === before) {
      return;
    }
  }
}

// Drives the signed-in new-request wizard from the welcome step to the
// confirm-request review page, prefilling a general-records (Access to
// Information Act) request. Uses real browser automation rather than raw HTTP
// because the portal's WAF blocks scripted form POSTs, and because the details
// form's radios write hidden mirror fields via JavaScript that only fire on a
// real click. Contact information is left as ATIP Online pre-populates it from
// the signed-in account. Leaves the page on the review step; never clicks
// Finish (which begins payment). Returns the resolved institution.
export async function prefillNewRequestToReview(
  page: Page,
  input: NewRequestInput
): Promise<PortalInstitution> {
  const eligibility = input.eligibilityValue ?? ELIGIBILITY.citizen;
  const format = input.formatValue ?? DELIVERY_FORMAT.account;

  // Welcome: general government records.
  await page.goto(`${ATIP_ONLINE_ORIGIN}/en`, {
    waitUntil: 'domcontentloaded',
  });
  await page.click(
    `input[name="SubjectId"][value="${GENERAL_RECORDS_SUBJECT_ID}"]`
  );
  await clickNext(page);

  // What you need to make a request: acknowledge the fee/preparation notice.
  await page.check('input[name="Acknowledged"]');
  await clickNext(page);

  // Choose an institution: resolve the query against the full server-rendered
  // list, then open its selector.
  await page.goto(`${ATIP_ONLINE_ORIGIN}/en/Organisation`, {
    waitUntil: 'domcontentloaded',
  });
  const institution = resolvePortalInstitution(
    parsePortalInstitutions(await page.content()),
    input.institution
  );
  await page.goto(
    `${ATIP_ONLINE_ORIGIN}/en/Organisation/Select/${institution.id}`,
    { waitUntil: 'domcontentloaded' }
  );

  // Institution introduction page: most institutions add a confirmation
  // checkbox that must be ticked before the details form is reachable.
  if (/\/Request\/IntroductionPage/i.test(page.url())) {
    const confirm = page.locator('input[name="Acknowledged"]');
    if (await confirm.count()) {
      await confirm.check();
    }
    await clickNext(page);
  }

  // Provide request details.
  await page.waitForURL(/\/Request\/Details/i, { timeout: 15_000 });
  await page.fill('#standardQuestion-RequestLabel', input.label);
  await page.fill('#standardQuestion-RequestDescription', input.description);
  // The eligibility and format radios each write a hidden *-Value field that the
  // form submits, populated by an onclick handler, so they must be clicked.
  await page.click(
    `input[name="standardQuestion-EligibilityId"][value="${eligibility}"]`
  );
  await page.click(
    `input[name="standardQuestion-RequestFormatId"][value="${format}"]`
  );

  await advanceToReview(page);
  return institution;
}
