import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

// Read-only CKAN API of the Open Government portal. No API key is needed.
export const OPEN_CANADA_API_BASE =
  'https://open.canada.ca/data/en/api/3/action';

// Consolidated "Completed Access to Information Request Summaries" datastore
// resource (dataset 0797e893-751e-4695-8229-a5066e4fe43c).
export const ATI_SUMMARIES_RESOURCE_ID = '19383ca2-b01a-487d-88f7-e1ffbc7d39c2';

export type AtiSummaryRecord = {
  _id: number;
  year: number;
  month: number;
  request_number: string;
  summary_en: string | null;
  summary_fr: string | null;
  disposition: string | null;
  pages: number | null;
  comments_en?: string | null;
  comments_fr?: string | null;
  umd_number?: string | null;
  owner_org: string;
  owner_org_title: string;
};

export type DatastoreSearchResult<T> = {
  total: number;
  records: T[];
};

export type CkanOrganization = {
  name: string;
  title: string;
};

type CkanEnvelope<T> = {
  success: boolean;
  result: T;
  error?: { message?: string };
};

export function buildActionUrl(
  action: string,
  params: Record<string, string>
): string {
  const url = new URL(`${OPEN_CANADA_API_BASE}/${action}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function callAction<T>(
  action: string,
  params: Record<string, string>
): Promise<T> {
  const response = await fetchWithTimeout(buildActionUrl(action, params));
  if (!response.ok) {
    throw new Error(
      `open.canada.ca returned HTTP ${response.status} for ${action}`
    );
  }
  const body = (await response.json()) as CkanEnvelope<T>;
  if (!body.success) {
    throw new Error(
      `open.canada.ca API call ${action} failed: ${
        body.error?.message ?? 'unknown error'
      }`
    );
  }
  return body.result;
}

export type AtiSearchParams = {
  query?: string;
  org?: string;
  year?: number;
  month?: number;
  limit?: number;
  offset?: number;
};

export async function searchAtiSummaries(
  params: AtiSearchParams
): Promise<DatastoreSearchResult<AtiSummaryRecord>> {
  const { query, org, year, month, limit = 10, offset = 0 } = params;
  const filters: Record<string, string | number> = {};
  if (org) {
    filters.owner_org = org;
  }
  if (year) {
    filters.year = year;
  }
  if (month) {
    filters.month = month;
  }
  const apiParams: Record<string, string> = {
    resource_id: ATI_SUMMARIES_RESOURCE_ID,
    limit: String(limit),
    offset: String(offset),
    sort: 'year desc, month desc',
  };
  if (query) {
    apiParams.q = query;
  }
  if (Object.keys(filters).length > 0) {
    apiParams.filters = JSON.stringify(filters);
  }
  return await callAction('datastore_search', apiParams);
}

function normalizeRequestNumber(requestNumber: string): string {
  return requestNumber.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Request numbers are typed inconsistently by institutions ("A-2025-00010"
// vs "A2025-00010"), so an exact datastore filter is tried first and a
// normalized full-text match is used as fallback.
export async function findAtiSummariesByRequestNumber(params: {
  requestNumber: string;
  org?: string;
}): Promise<AtiSummaryRecord[]> {
  const { requestNumber, org } = params;
  const filters: Record<string, string> = { request_number: requestNumber };
  if (org) {
    filters.owner_org = org;
  }
  const exact = await callAction<DatastoreSearchResult<AtiSummaryRecord>>(
    'datastore_search',
    {
      resource_id: ATI_SUMMARIES_RESOURCE_ID,
      filters: JSON.stringify(filters),
      limit: '50',
    }
  );
  if (exact.records.length > 0) {
    return exact.records;
  }
  const fullText = await searchAtiSummaries({
    query: requestNumber,
    org,
    limit: 50,
  });
  const wanted = normalizeRequestNumber(requestNumber);
  return fullText.records.filter(
    record => normalizeRequestNumber(record.request_number) === wanted
  );
}

export async function listOrganizations(): Promise<CkanOrganization[]> {
  return await callAction<CkanOrganization[]>('organization_list', {
    all_fields: 'true',
    limit: '1000',
  });
}

const DISPOSITION_LABELS: Record<string, string> = {
  DA: 'All disclosed',
  DP: 'Disclosed in part',
  EC: 'All excluded',
  EX: 'All exempted',
  NE: 'No records exist',
};

export function formatDisposition(code: string | null): string {
  if (!code) {
    return 'Unknown disposition';
  }
  return DISPOSITION_LABELS[code.toUpperCase()] ?? code;
}

// Titles on open.canada.ca are bilingual ("English | Français").
export function englishTitle(bilingualTitle: string): string {
  return bilingualTitle.split(' | ')[0];
}
