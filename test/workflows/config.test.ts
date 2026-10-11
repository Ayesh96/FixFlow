import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { githubCloneUrl } from '../../server/workflows/config.ts';

describe('shared workflow settings', () => {
  it('clones from github.com unless told otherwise, and takes a different address for GitHub Enterprise', () => {
    assert.equal(githubCloneUrl({}), 'https://github.com/{repo}.git');
    assert.equal(githubCloneUrl({ ORCH_GITHUB_CLONE_URL: ' https://git.example.com/{repo}.git ' }), 'https://git.example.com/{repo}.git');
  });

  it('refuses a clone address with nowhere to put the repository, rather than cloning the wrong thing', () => {
    assert.throws(() => githubCloneUrl({ ORCH_GITHUB_CLONE_URL: 'https://git.example.com/some/repo.git' }), /\{repo\}/);
  });
});
