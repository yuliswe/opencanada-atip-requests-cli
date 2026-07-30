import {
  ATI_SUMMARIES_RESOURCE_ID,
  buildActionUrl,
  englishTitle,
  findAtiSummariesByRequestNumber,
  formatDisposition,
  searchAtiSummaries,
  type AtiSummaryRecord,
} from '@/utils/ckan';
import { buildAtiSearchPageUrl } from '@/utils/urls';

function mockCkanResponse(result: unknown): Response {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sampleRecord(overrides: Partial<AtiSummaryRecord>): AtiSummaryRecord {
  return {
    _id: 1,
    year: 2026,
    month: 3,
    request_number: 'A-2026-00001',
    summary_en: 'Sample summary',
    summary_fr: null,
    disposition: 'DP',
    pages: 12,
    owner_org: 'cic',
    owner_org_title:
      'Immigration, Refugees and Citizenship Canada | Immigration, Réfugiés et Citoyenneté Canada',
    ...overrides,
  };
}

describe('buildActionUrl', () => {
  it('builds datastore_search URLs against the open.canada.ca API', () => {
    const url = buildActionUrl('datastore_search', {
      resource_id: ATI_SUMMARIES_RESOURCE_ID,
      limit: '5',
    });
    expect(url).toBe(
      'https://open.canada.ca/data/en/api/3/action/datastore_search' +
        `?resource_id=${ATI_SUMMARIES_RESOURCE_ID}&limit=5`
    );
  });
});

describe('searchAtiSummaries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes query, filters, and pagination to datastore_search', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockCkanResponse({ total: 0, records: [] }));
    await searchAtiSummaries({
      query: 'immigration backlog',
      org: 'cic',
      year: 2025,
      limit: 5,
      offset: 10,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get('resource_id')).toBe(ATI_SUMMARIES_RESOURCE_ID);
    expect(url.searchParams.get('q')).toBe('immigration backlog');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('offset')).toBe('10');
    expect(JSON.parse(url.searchParams.get('filters') ?? '{}')).toEqual({
      owner_org: 'cic',
      year: 2025,
    });
  });

  it('throws when the API reports failure', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: { message: 'nope' } }),
          { status: 200 }
        )
      );
    await expect(searchAtiSummaries({ query: 'x' })).rejects.toThrow(/nope/);
  });
});

describe('findAtiSummariesByRequestNumber', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns exact filter matches without falling back', async () => {
    const record = sampleRecord({});
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockCkanResponse({ total: 1, records: [record] }));
    const records = await findAtiSummariesByRequestNumber({
      requestNumber: 'A-2026-00001',
    });
    expect(records).toEqual([record]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to a normalized full-text match', async () => {
    const match = sampleRecord({ request_number: 'A2026-00001' });
    const other = sampleRecord({ _id: 2, request_number: 'A-2026-00099' });
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockCkanResponse({ total: 0, records: [] }))
      .mockResolvedValueOnce(
        mockCkanResponse({ total: 2, records: [match, other] })
      );
    const records = await findAtiSummariesByRequestNumber({
      requestNumber: 'A-2026-00001',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(records).toEqual([match]);
  });
});

describe('formatting helpers', () => {
  it('maps disposition codes to labels and passes through unknowns', () => {
    expect(formatDisposition('DP')).toBe('Disclosed in part');
    expect(formatDisposition('NE')).toBe('No records exist');
    expect(formatDisposition(null)).toBe('Unknown disposition');
    expect(formatDisposition('Disclosed entirely')).toBe('Disclosed entirely');
  });

  it('extracts the English half of bilingual titles', () => {
    expect(
      englishTitle('Treasury Board of Canada Secretariat | Secrétariat')
    ).toBe('Treasury Board of Canada Secretariat');
    expect(englishTitle('No separator')).toBe('No separator');
  });

  it('builds the pre-filtered ATI search page URL', () => {
    expect(buildAtiSearchPageUrl('A-2026-00001')).toBe(
      'https://open.canada.ca/en/search/ati?search_api_fulltext=A-2026-00001'
    );
  });
});
