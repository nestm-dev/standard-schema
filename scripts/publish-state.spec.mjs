import { describe, expect, it } from 'vitest';

import { resolvePrereleaseTag } from './publish-state.mjs';

describe('resolvePrereleaseTag', () => {
  it('returns the matching Changesets pre-mode tag', () => {
    expect(
      resolvePrereleaseTag('0.1.0-alpha.2', {
        mode: 'pre',
        tag: 'alpha',
      }),
    ).toBe('alpha');
    expect(
      resolvePrereleaseTag('0.1.0-alpha+build.1', {
        mode: 'pre',
        tag: 'alpha',
      }),
    ).toBe('alpha');
  });

  it('allows a stable version outside pre mode', () => {
    expect(resolvePrereleaseTag('1.0.0', undefined)).toBeUndefined();
    expect(
      resolvePrereleaseTag('1.0.0', {
        mode: 'exit',
        tag: 'alpha',
      }),
    ).toBeUndefined();
  });

  it('rejects a prerelease without Changesets pre mode', () => {
    expect(() => resolvePrereleaseTag('0.1.0-alpha.2', undefined)).toThrow(
      'requires Changesets pre mode',
    );
  });

  it('rejects a prerelease identifier that differs from the tag', () => {
    expect(() =>
      resolvePrereleaseTag('0.1.0-beta.1', {
        mode: 'pre',
        tag: 'alpha',
      }),
    ).toThrow('does not match Changesets tag');
  });

  it('rejects a stable version while pre mode is active', () => {
    expect(() =>
      resolvePrereleaseTag('1.0.0', {
        mode: 'pre',
        tag: 'alpha',
      }),
    ).toThrow('cannot publish in Changesets pre mode');
  });
});
