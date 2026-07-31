import {
  InstitutionNotFoundError,
  parsePortalInstitutions,
  parseWizardStep,
  resolvePortalInstitution,
} from '@/utils/portalWizard';

// Trimmed to the shape the real /en/Organisation table renders: an orgSelector
// link to Select/{id} plus online, count, acronym, and view cells.
const INSTITUTION_TABLE = `
<table id="Organizations"><tbody>
  <tr class="request_row">
    <td><a class="orgSelector" href="/en/Organisation/Select/10">Canada Border Services Agency</a></td>
    <td>Yes</td><td>61021</td><td>CBSA</td>
    <td class="text-center"><a href="#purpose_10" class="ViewOrg">View</a></td>
  </tr>
  <tr class="request_row">
    <td><a class="orgSelector" href="/en/Organisation/Select/8">Library and Archives Canada</a></td>
    <td>Yes</td><td>8671</td><td>LAC</td>
    <td class="text-center"><a href="#purpose_8" class="ViewOrg">View</a></td>
  </tr>
  <tr class="request_row">
    <td><a class="orgSelector" href="/en/Organisation/Select/72">Canada Revenue Agency</a></td>
    <td>Yes</td><td>11458</td><td>CRA</td>
    <td class="text-center"><a href="#purpose_72" class="ViewOrg">View</a></td>
  </tr>
</tbody></table>`;

describe('parsePortalInstitutions', () => {
  it('extracts id, name, and acronym for each institution row', () => {
    expect(parsePortalInstitutions(INSTITUTION_TABLE)).toEqual([
      { id: '10', name: 'Canada Border Services Agency', acronym: 'CBSA' },
      { id: '8', name: 'Library and Archives Canada', acronym: 'LAC' },
      { id: '72', name: 'Canada Revenue Agency', acronym: 'CRA' },
    ]);
  });

  it('ignores rows without an orgSelector link', () => {
    expect(parsePortalInstitutions('<tr><td>header</td></tr>')).toEqual([]);
  });
});

describe('resolvePortalInstitution', () => {
  const institutions = parsePortalInstitutions(INSTITUTION_TABLE);

  it('matches an exact numeric id', () => {
    expect(resolvePortalInstitution(institutions, '8').acronym).toBe('LAC');
  });

  it('matches an acronym case-insensitively', () => {
    expect(resolvePortalInstitution(institutions, 'cbsa').id).toBe('10');
  });

  it('matches a unique name substring', () => {
    expect(resolvePortalInstitution(institutions, 'Revenue').id).toBe('72');
  });

  it('throws with candidates when the query is ambiguous', () => {
    expect(() => resolvePortalInstitution(institutions, 'Canada')).toThrow(
      InstitutionNotFoundError
    );
  });

  it('throws when nothing matches', () => {
    expect(() => resolvePortalInstitution(institutions, 'Hogwarts')).toThrow(
      /No single institution/
    );
  });
});

describe('parseWizardStep', () => {
  it('reads the antiforgery token, the Next button formaction, and hidden fields', () => {
    const html = `
      <form method="post">
        <input name="WhatYouNeedText" type="hidden" value="keep-me" />
        <input name="Acknowledged" type="checkbox" />
        <button id="Previous" type="submit" formaction="/en/Home/Back">Previous</button>
        <button id="Next" type="submit" formaction="/en/Home/WhatYouNeed">Next</button>
        <input name="__RequestVerificationToken" type="hidden" value="tok123" />
      </form>`;
    expect(parseWizardStep(html)).toEqual({
      token: 'tok123',
      nextAction: '/en/Home/WhatYouNeed',
      hiddens: { WhatYouNeedText: 'keep-me' },
    });
  });

  it('falls back to the only submit target when no button says Next', () => {
    const html = `
      <button type="submit" formaction="/en/Only/Target">Continue</button>
      <input name="__RequestVerificationToken" type="hidden" value="t" />`;
    expect(parseWizardStep(html).nextAction).toBe('/en/Only/Target');
  });
});
