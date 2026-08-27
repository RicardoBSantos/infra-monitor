import { PageResponse } from './page-response';

describe('PageResponse', () => {
  it('represents the public zero-based pagination contract', () => {
    const page: PageResponse<string> = {
      content: ['unidade-a'],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
      first: true,
      last: true,
    };

    expect(page.page).toBe(0);
    expect(page.content).toEqual(['unidade-a']);
  });
});
