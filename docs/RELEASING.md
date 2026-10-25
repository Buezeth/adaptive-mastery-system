# Releasing

Maintainer notes for publishing `adaptive-mastery` to npm. This exists because npm's token rules
changed in late 2025 and the failure mode is a misleading `E403` unless you know the cause.

## The constraint that shapes everything

Since [November 2025](https://github.blog/changelog/2025-11-05-npm-security-update-classic-token-creation-disabled-and-granular-token-changes/):

- **Classic npm tokens no longer exist.** Any tutorial telling you to create an "Automation" token is
  describing a dead feature.
- **Granular tokens with write permission enforce 2FA by default**, and publishing from the CLI
  needs either a `--otp` code or a token with **Bypass 2FA** enabled.
- `npm login` yields a short-lived **session token**, not a long-lived publishing credential.

If the account's 2FA is a **passkey managed by the browser** (Chrome, iCloud Keychain, Windows
Hello), there is no 6-digit code to type, so `npm publish --otp=…` can never work. The error you get
is not `EOTP`, it is:

```
E403 403 Forbidden - PUT https://registry.npmjs.org/<pkg>
Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

That message means: *this credential cannot publish, and no code you could type would help.*

## One-time setup

Create a publishing token at <https://www.npmjs.com/settings/~/tokens>:

1. **Generate New Token** → **Granular Access Token**
2. Permissions: **Read and write**
3. Packages: **All packages** — for a brand-new package you cannot select it yet
4. Tick **Bypass 2FA**
5. Set the shortest workable expiry (write tokens are capped at 90 days)

Use it only for releases. Two ways to supply it:

```powershell
# A: environment variable, per shell
$env:NPM_TOKEN = 'npm_…'

# B: project-local .npmrc — must stay gitignored
# //registry.npmjs.org/:_authToken=npm_…
```

Never commit it. `.npmrc` is already in `.gitignore`.

> A config file contains **only** `key=value`. Writing `npm config set …` into `.npmrc` produces a
> malformed key, and because project config outranks user config, npm then authenticates as nobody.

## Release steps

1. Bump `version` in `package.json`; add a `CHANGELOG.md` entry (Added / Changed / Fixed).
2. `npm test` — 35 tests, must be green.
3. `node tools/preflight-review.mjs templates/feature-guide-template.md` — exit `0`.
4. Confirm what ships: `npm pack --dry-run` (28 files, no `tests/`, no `.github/`).
5. Publish from the repository root:
   ```powershell
   $env:NPM_TOKEN = 'npm_…'   # if not already set
   npm publish --access public
   ```
6. Wait for propagation, then verify — this takes a minute for a first release:
   ```powershell
   npm view adaptive-mastery version        # expect the new version
   npx -y adaptive-mastery@<version> --help
   ```
7. Tag and release:
   ```powershell
   git tag -a v<version> -m "v<version>"
   git push origin main --tags
   ```
   Then create the GitHub release from the changelog entry.

## First publish of a new package only

The registry creates a `0.0.0-stage` placeholder while the upload is processed. It is not a real
release; do not panic and do not publish again. Within a minute or two `npm view` reports the real
version and `latest` points at it. `npm install` may still fail with `ETARGET` during that window —
that is a propagation race, and retrying is the fix.

## Two gotchas worth remembering

**Do not run `npx adaptive-mastery` from inside this repository.** npm resolves the local `bin` first,
and this package has no local install, so it fails with `'adaptive-mastery' is not recognized`.
Use `node install/cli.mjs …` here, or run `npx` from the project you are installing into.

**Revoke the token when the release is done**, or immediately if it was ever pasted into a chat,
ticket or log. Rotating a publish token costs one browser action; rotating a compromised one costs
trust.

## Recovering a lost authenticator

Recovery codes are displayed once, when 2FA is enabled, and they are equivalent to the second factor.
Store them in a password manager — never in a chat window or a repository. If they were exposed,
regenerate them from the account's Two-factor authentication settings.
