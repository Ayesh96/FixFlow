import { describe, expect, it } from 'vitest';
import { LIST_HREF, projectHref, projectIdFromHash } from './useProjectRoute';

describe('project routes', () => {
  it("reads the project id out of a project page's hash", () => {
    expect(projectIdFromHash('#/projects/1')).toBe('1');
    expect(projectIdFromHash('#/projects/abc-2?tab=x')).toBe('abc-2');
    expect(projectIdFromHash('#/projects/a%20b')).toBe('a b');
  });

  it('treats the list, an empty hash and anything else as no project', () => {
    for (const hash of ['', '#', LIST_HREF, '#/other/1', '#/projects/', '#/projects/%E0%A4%A']) expect(projectIdFromHash(hash)).toBeNull();
  });

  it('builds links that read back to the same id', () => {
    for (const id of ['1', 'a b', 'x/y']) expect(projectIdFromHash(projectHref(id))).toBe(id);
  });
});
