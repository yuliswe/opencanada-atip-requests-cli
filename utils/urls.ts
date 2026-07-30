// ATIP Online (AORS), where formal requests are submitted and tracked. The
// portal has no public API: sign-in goes through Sign-In Canada / CanadaLogin
// and the $5 application fee is collected by Moneris, so those steps must
// happen in a browser.
export const ATIP_ONLINE_PORTAL_URL = 'https://atip-aiprp.tbs-sct.gc.ca/en';

export const ATI_SEARCH_PAGE_URL = 'https://open.canada.ca/en/search/ati';

// The "Request a copy of records" (informal request) form is embedded on each
// record page of the ATI search, so the closest deep link is the search page
// pre-filtered to the request number.
export function buildAtiSearchPageUrl(fullText: string): string {
  const url = new URL(ATI_SEARCH_PAGE_URL);
  url.searchParams.set('search_api_fulltext', fullText);
  return url.toString();
}
