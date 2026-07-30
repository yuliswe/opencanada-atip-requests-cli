import {
  applySetCookies,
  extractAntiforgeryToken,
  fetchRequestList,
  parseCookieHeader,
  refreshSession,
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

// Mirrors the real GetMyRequestsList HTML fragment: a <tr class="request_row">
// with a detail link carrying the id and reference number, then label,
// institution, type (<abbr>), visible date, hidden datetime, status
// (request-status-* class), and new-messages cells.
function requestRow(overrides: {
  id: string;
  reference: string;
  label: string;
  statusClass: string;
  statusText: string;
  date: string;
  newMessages: string;
}): string {
  return `
    <tr class="request_row">
      <td class="nowrap"><a href="/en/YourRequestDetails/Index/${overrides.id}?tab=S" title="View">${overrides.reference}</a></td>
      <td class="col-md-2">${overrides.label}</td>
      <td class="col-md-5">Immigration, Refugees and Citizenship Canada</td>
      <td><abbr title="Access to information request">ATI</abbr></td>
      <td class="nowrap">${overrides.date}</td>
      <td class="nowrap hidden">${overrides.date} 12:59:06</td>
      <td class="nowrap ${overrides.statusClass}">${overrides.statusText}<span class="glyphicon"></span></td>
      <td class="nowrap text-center"><span>${overrides.newMessages}</span></td>
    </tr>`;
}

function listTableHtml(rows: string[]): string {
  return `<table class="dataTable"><thead><tr><th>Request ID</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
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

  it('scrapes the antiforgery token then parses the HTML table rows', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse(LIST_HTML, {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList',
        })
      )
      .mockResolvedValueOnce(
        mockResponse(
          listTableHtml([
            requestRow({
              id: '550889',
              reference: 'EA2026_0160384',
              label: 'IRCC-security-screening-simple-stats',
              statusClass: 'request-status-in-progress',
              statusText: 'In progress',
              date: '2026-02-28',
              newMessages: 'N/A',
            }),
            requestRow({
              id: '548962',
              reference: 'EA2026_0159900',
              label: 'IRCC-security-screening-data',
              statusClass: 'request-status-closed',
              statusText: 'Closed',
              date: '2026-02-25',
              newMessages: '2',
            }),
          ]),
          {
            url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList/GetMyRequestsList',
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
        referenceNumber: 'EA2026_0160384',
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
        referenceNumber: 'EA2026_0159900',
        label: 'IRCC-security-screening-data',
        institution: 'Immigration, Refugees and Citizenship Canada',
        type: 'Access to information request',
        dateSubmitted: '2026-02-25',
        status: 'Closed',
        newMessages: 2,
        detailUrl:
          'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestDetails/Index/548962',
      },
    ]);
  });

  it('returns nothing when the table has no request rows', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockResponse(LIST_HTML, {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList',
        })
      )
      .mockResolvedValueOnce(
        mockResponse(listTableHtml([]), {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList/GetMyRequestsList',
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
        mockResponse(listTableHtml([]), {
          url: 'https://atip-aiprp.tbs-sct.gc.ca/en/YourRequestList/GetMyRequestsList',
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

describe('refreshSession', () => {
  afterEach(() => jest.restoreAllMocks());

  it('merges reissued cookies and slides the expiry on a "true" response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('true', {
        url: 'https://atip-aiprp.tbs-sct.gc.ca/en/Session/Refresh',
        contentType: 'application/json',
        setCookie: 'ATIP=NEWVALUE; path=/; httponly',
      })
    );
    const now = new Date('2026-07-30T12:00:00.000Z');
    const refreshed = await refreshSession(SESSION, now);
    expect(refreshed.cookie).toContain('.AspNetCore.Cookies=abc');
    expect(refreshed.cookie).toContain('ATIP=NEWVALUE');
    expect(refreshed.expiresAt).toBe('2026-07-30T12:20:00.000Z');
  });

  it('throws SessionExpiredError when the refresh redirects to sign-in', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('<h1>sign in</h1>', {
        url: 'https://atip-aiprp.tbs-sct.gc.ca/en/Home/Signin',
      })
    );
    await expect(refreshSession(SESSION)).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });

  it('throws SessionExpiredError when the body is not "true"', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse('false', {
        url: 'https://atip-aiprp.tbs-sct.gc.ca/en/Session/Refresh',
        contentType: 'application/json',
      })
    );
    await expect(refreshSession(SESSION)).rejects.toBeInstanceOf(
      SessionExpiredError
    );
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
