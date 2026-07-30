const semverPrereleasePattern =
  /^[0-9]+\.[0-9]+\.[0-9]+-([0-9A-Za-z-]+)(?:[.+]|$)/;

export function resolvePrereleaseTag(version, preState) {
  if (typeof version !== 'string') {
    throw new TypeError('package.json requires a string version');
  }

  const prereleaseIdentifier = semverPrereleasePattern.exec(version)?.[1];

  if (preState?.mode === 'pre') {
    if (typeof preState.tag !== 'string' || preState.tag.length === 0) {
      throw new Error('Changesets prerelease mode requires a non-empty tag');
    }

    if (prereleaseIdentifier === undefined) {
      throw new Error(
        `Stable version ${version} cannot publish in Changesets pre mode`,
      );
    }

    if (prereleaseIdentifier !== preState.tag) {
      throw new Error(
        `Version prerelease ${prereleaseIdentifier} does not match Changesets tag ${preState.tag}`,
      );
    }

    return preState.tag;
  }

  if (prereleaseIdentifier !== undefined) {
    throw new Error(
      `Prerelease version ${version} requires Changesets pre mode`,
    );
  }

  return undefined;
}
