import {
  applySetCookies,
  extractAntiforgeryToken,
  fetchRequestList,
  parseCookieHeader,
  serializeCookieJar,
  SessionExpiredError,
  verifySession,
} from '@/utils/portal';
import { type PortalSession } from '@/utils/session';

const SESSION: PortalSession = {
  cookie: '.AspNetCore.Cookies=abc; .AspNetCore.Antiforgery.x=def',
  headers: {},
  expiresAt: null,
  capturedAt: '2026-07-30T00:00:00.000Z',
};

function mockResponse(
  body: string,
  init: {
    url: string;
    status?: number;
    contentType?: string;
    setCookie?: string;
  }
): Response {
  const headers = new Headers({
    'content-type': init.contentType ?? 'text/html',
  });
  if (init.setCookie) {
    headers.append('set-cookie', init.setCookie);
  }
  const res = new Response(body, { status: init.status ?? 200, headers });
  // Response.url is read-only and empty for synthesized responses; the portal
  // client reads it to detect sign-in redirects, so it must be set explicitly.
  Object.defineProperty(res, 'url', { value: init.url });
  return res;
}

const LIST_HTML =
  '<form><input name="__RequestVerificationToken" type="hidden" value="TOKEN-123" /></form>';

function dataTablesRow(overrides: {
  id: string;
  label: string;
  status: string;
  newMessages: string;
}): string[] {
  return [
    `<a href="/en/YourRequestDetails/Index/${overrides.id}?tab=S">View</a>`,
    overrides.label,
    'Immigration, Refugees and Citizenship Canada',
    'Access to information request',
    '2026-02-28 12:59:06',
    overrides.status,
    overrides.newMessages,
  ];
}

describe('verifySession', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves when the dashboard loads authenticated', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('<h1>dashboard</h1>', {
        url: 'https://atip-aiprp.tbs-sct.gc.ca/en/Dashboard',
      })
    );
    await expect(verifySession(SESSION)).resolves.toBeUndefined();
  });

  it('throws SessionExpiredError when redirected to sign-in', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('<h1>sign in</h1>', {
        url: 'https://atip-aiprp.tbs-sct.gc.ca/en/Home/Signin',
      })
    );
    await expect(verifySession(SESSION)).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });

  it('throws SessionExpiredError when redirected off-origin to the IdP', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('<h1>login</h1>', {
        url: 'https://auth.id.canada.ca/oxauth/authorize.htm',
      })
    );
    await expect(verifySession(SESSION)).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });
});

describe('fetchRequestList', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scrapes the antiforgery token then parses DataTables rows', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse(LIST_HTML, {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList',
        })
      )
      .mockResolvedValueOnce(
        mockResponse(
          JSON.stringify({
            draw: 1,
            recordsTotal: 2,
            data: [
              dataTablesRow({
                id: '550889',
                label: 'IRCC-security-screening-simple-stats',
                status: 'In progress',
                newMessages: 'N/A',
              }),
              dataTablesRow({
                id: '548962',
                label: 'IRCC-security-screening-data',
                status: 'Closed',
                newMessages: '2',
              }),
            ],
          }),
          {
            url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList/GetMyRequestsList',
            contentType: 'application/json',
          }
        )
      );

    const requests = await fetchRequestList(SESSION);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const postInit = fetchSpy.mock.calls[1][1];
    expect(postInit?.method).toBe('POST');
    expect(String(postInit?.body)).toContain(
      '__RequestVerificationToken=TOKEN-123'
    );

    expect(requests).toEqual([
      {
        id: '550889',
        label: 'IRCC-security-screening-simple-stats',
        institution: 'Immigration, Refugees and Citizenship Canada',
        type: 'Access to information request',
        dateSubmitted: '2026-02-28',
        status: 'In progress',
        newMessages: 0,
        detailUrl:
          'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestDetails/Index/550889',
      },
      {
        id: '548962',
        label: 'IRCC-security-screening-data',
        institution: 'Immigration, Refugees and Citizenship Canada',
        type: 'Access to information request',
        dateSubmitted: '2026-02-28',
        status: 'Closed',
        newMessages: 2,
        detailUrl:
          'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestDetails/Index/548962',
      },
    ]);
  });

  it('drops rows with no detail link', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse(LIST_HTML, {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList',
        })
      )
      .mockResolvedValueOnce(
        mockResponse(JSON.stringify({ data: [['no link here', 'x', 'y']] }), {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList/GetMyRequestsList',
          contentType: 'application/json',
        })
      );
    await expect(fetchRequestList(SESSION)).resolves.toEqual([]);
  });

  it('forwards the antiforgery cookie set by the token GET onto the POST', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse(LIST_HTML, {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList',
          setCookie:
            '.AspNetCore.Antiforgery.NEW=FRESH-COOKIE; path=/; samesite=strict; httponly',
        })
      )
      .mockResolvedValueOnce(
        mockResponse(JSON.stringify({ data: [] }), {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList/GetMyRequestsList',
          contentType: 'application/json',
        })
      );

    await fetchRequestList(SESSION);

    const postInit = fetchSpy.mock.calls[1][1];
    const cookie = new Headers(postInit?.headers).get('cookie') ?? '';
    // The original session cookies survive and the freshly set antiforgery
    // cookie is merged in, so the token and its cookie now match.
    expect(cookie).toContain('.AspNetCore.Cookies=abc');
    expect(cookie).toContain('.AspNetCore.Antiforgery.NEW=FRESH-COOKIE');
  });
});

describe('cookie jar helpers', () => {
  it('parses, merges Set-Cookie, and re-serializes', () => {
    const jar = parseCookieHeader('.AspNetCore.Cookies=abc; TS=1');
    applySetCookies(jar, [
      '.AspNetCore.Antiforgery.k=NEW; path=/; httponly',
      'TS=2; path=/',
    ]);
    expect(serializeCookieJar(jar)).toBe(
      '.AspNetCore.Cookies=abc; TS=2; .AspNetCore.Antiforgery.k=NEW'
    );
  });
});

describe('extractAntiforgeryToken', () => {
  it('extracts regardless of attribute order or quote style', () => {
    expect(
      extractAntiforgeryToken(
        '<input name="__RequestVerificationToken" type="hidden" value="AAA" />'
      )
    ).toBe('AAA');
    expect(
      extractAntiforgeryToken(
        "<input type='hidden' value='BBB' name='__RequestVerificationToken'>"
      )
    ).toBe('BBB');
    expect(extractAntiforgeryToken('<p>no token here</p>')).toBeNull();
  });
});
