# Security Policy

## Supported versions

Until the first stable release, security fixes are made against the latest published prerelease. Users should upgrade to the newest available version and pin the exact version they have tested with their NestJS 12 prerelease.

After stable releases begin, this policy will be updated with an explicit support table.

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue, discussion, or pull request.

Use the repository's private **Report a vulnerability** flow when it is available:

<https://github.com/nestm-dev/nestjs-standard-schema/security/advisories/new>

If private vulnerability reporting is not available, contact a repository maintainer through a private channel listed on their GitHub profile before sending sensitive details.

Include:

- the affected package version and NestJS version;
- a minimal reproduction or proof of concept;
- the expected and observed behavior;
- the likely impact; and
- any mitigation you have already tested.

Please allow time for investigation and a coordinated release before public disclosure. Response times may vary while the project is in prerelease.

## Scope

Reports about schema bypasses, unsafe transformation, unintended data exposure during serialization, dependency compromise, or misleading runtime/type behavior are especially useful.

For vulnerabilities in NestJS, a schema library, or another dependency that do not originate in this adapter, follow that project's security policy. You may still notify this project privately when an upstream issue requires a compatibility fix or mitigation here.
