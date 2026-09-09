# Desktop Releases and Updates

## Release Model

CLI and desktop share the root `package.json` version. `npm version patch` (or minor/major) runs the version hook, synchronizes workspace packages, the Tauri config, the Rust package, and both lockfiles, and stages those files for npm's version commit. Rust and Node must be installed when bumping versions. `npm run version:sync` repairs drift without creating a commit; `npm run version:check` validates it.

The existing Publish workflow detects a new version on `main`, validates it, creates an immutable `vX.Y.Z` tag and a **draft** GitHub Release, publishes npm, and updates Homebrew. Its reusable Desktop Release workflow builds:

| Platform            | Installers          | In-app updater artifact |
| ------------------- | ------------------- | ----------------------- |
| macOS Apple Silicon | `.dmg`              | `.app.tar.gz`           |
| macOS Intel         | `.dmg`              | `.app.tar.gz`           |
| Windows x64         | NSIS `.exe`         | Same signed `.exe`      |
| Linux x64           | `.AppImage`, `.deb` | Signed `.AppImage`      |

Each native runner bundles its own architecture's Node runtime and license. Separate macOS builds avoid putting a single-architecture Node sidecar in a universal app. Android remains deferred.

Each updater artifact is signed and independently verified against the public key embedded in the app. Matrix jobs upload workflow artifacts, not a shared manifest. A single final job checks all four platforms, creates `latest.json` and `SHA256SUMS.txt`, uploads everything, verifies the uploaded asset list, and only then publishes the draft as the latest release. A failed build never promotes an incomplete update manifest. Publishing an older version over a newer public version is refused.

The updater endpoint is `https://github.com/Carlos-err406/visuales-search/releases/latest/download/latest.json`. Manifest asset URLs name the immutable version tag, never `latest`, so a later release cannot change an update already being downloaded. Do not manually publish CLI-only GitHub releases after enabling desktop updates: they would replace the latest release without its update manifest.

## One-Time Signing Setup

Visuales' dedicated updater public key is configured. The private key is stored outside the repository and in the `TAURI_SIGNING_PRIVATE_KEY` Actions secret. Do not regenerate it for a routine release.

Use a dedicated Visuales updater key, not another app's key. The public key is committed; the private key and optional password must stay outside the repository and go into GitHub Actions secrets. Back up the private key securely: existing installations trust that key for future updates.

```sh
npm --prefix apps/desktop run tauri -- signer generate --write-keys "$HOME/.tauri/visuales.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo Carlos-err406/visuales-search < "$HOME/.tauri/visuales.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo Carlos-err406/visuales-search
```

Set `plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json` to the contents of `visuales.key.pub`, not its file path. The password secret must match the generated key; an unencrypted key uses an empty password. Do not print the private key or password in logs. Release workflows fail before publishing if the public key or private-key secret is missing, and signature verification catches mismatched keys.

Updater signatures are **not** Apple Developer ID signing/notarization or Windows Authenticode. No platform certificates are configured here. The chosen macOS distribution policy is ad-hoc signing with explicit user approval in Privacy & Security, without a paid Apple Developer account. First-install Gatekeeper/SmartScreen warnings can remain; do not describe these packages as notarized or SmartScreen-trusted.

macOS bundles use explicit ad-hoc signing (`signingIdentity: "-"`) so the complete app and its resources are sealed, rather than retaining only the linker's executable signature. The bundled Node runtime needs the `allow-jit` entitlement when Tauri re-signs it. Both desktop workflows run `codesign --verify --deep --strict` and execute a bundled Node/V8 smoke test before accepting the build. These checks catch malformed signatures, but do not establish Apple trust: ad-hoc builds still require user approval through macOS Privacy & Security. A warning-free distribution requires Developer ID signing and Apple notarization. See [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).

Normal development builds do not generate signed update artifacts. Release builds opt in through `apps/desktop/src-tauri/tauri.release.conf.json` and require the signing key. Clearing the public-key field disables update checks and prevents release publication.

## Homebrew Desktop Installation

After the first desktop release is published:

```sh
brew install --cask Carlos-err406/visuales/visuales-desktop
```

The existing `visuales` formula remains the CLI. The desktop cask installs `Visuales.app`, selects the Apple Silicon or Intel DMG automatically, and does not install another CLI or remove shared cache/download data on uninstall. macOS 13.5 or newer is required by the bundled Node 24 runtime; the cask requires Ventura and the app declares the precise minimum.

After publishing all desktop artifacts, Desktop Release invokes **Publish Desktop Homebrew Cask**. It verifies that the tag is the latest public stable release, generates architecture-specific SHA-256 values from its published `SHA256SUMS.txt`, and commits only `Casks/visuales-desktop.rb` in `Carlos-err406/homebrew-visuales`, using the existing `HOMEBREW_TAP_TOKEN`. Build-only rehearsals never modify the tap.

The cask declares `auto_updates true`. Prefer the in-app updater; to explicitly update through Homebrew, use `brew upgrade --cask --greedy visuales-desktop`. Homebrew installation does not bypass Gatekeeper or replace platform code signing. See the [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook) and [Node 24 platform requirements](https://github.com/nodejs/node/blob/v24.18.0/BUILDING.md#platform-list).

For first launch, try opening Visuales, then use **System Settings > Privacy & Security > Open Anyway** for Visuales and confirm **Open** if you trust the installed release. The cask and README surface this requirement. Do not disable Gatekeeper globally or automatically strip quarantine flags. Organization-managed Macs may prohibit per-app approval. See [Apple's approval instructions](https://support.apple.com/en-us/102445).

If the cask job fails after app publication, rerun that failed job or dispatch **Publish Desktop Homebrew Cask** with the latest tag. This does not rebuild or republish installers. Repeating the same cask update is a no-op; older releases are refused.

## First Release

`v1.3.10` already exists as a CLI release. Do not reuse or move that tag. After committing this migration and configuring signing:

1. Run `npm run release:check`, `npm run version:check`, `npm run rust:test`, and `npm run test:signatures`.
2. Install Playwright's Chromium (`npx playwright install chromium`), then run `npm run test:desktop`. The runner starts an isolated Vite server on a free port and uses mocked IPC; it never touches real transfers.
3. Push the reviewed code, then dispatch **Desktop Release** with `publish=false` and an empty tag to rehearse all four native builds on the chosen ref. This creates workflow artifacts only. Inspect installers, launch the bundled runtime, and test an update on disposable installations on each OS.
4. The corrected desktop release uses the shared version `2.0.1`. The `2.0.0` npm package was published, but Windows core tests blocked desktop publication; its tag must not move. Push the reviewed release commit to `main`. Publish invokes Desktop Release explicitly: tags created by `GITHUB_TOKEN` do not reliably trigger another tag-push workflow.
5. Confirm npm, Homebrew, all platform builds, signature checks, and final release publication succeeded. Verify the public manifest and upgrade a previously installed signed build.

No workflow in this setup commits a release bump automatically. The version-bump commit remains the publishing trigger. npm continues to use the repository's existing trusted-publishing configuration; Homebrew still uses `HOMEBREW_TAP_TOKEN`.

## In-App Behavior

- Release builds check on launch and every six hours. Debug builds offer manual checks only. Browser previews never invoke a native updater.
- An available update opens a compact notice across Search, Downloads, and Settings. Installed version, last successful check, routine status, and manual checks live in Settings; there is no header up-arrow.
- Later hides an available-update notice until the next scheduled check or app launch. The checked release remains downloadable in Settings. Download progress, errors from a download attempt, and restart readiness remain visible across views.
- Checking never downloads, installs, or restarts automatically. Download progress is separate from content transfers; unknown sizes stay indeterminate.
- The native Tauri updater verifies the signature before storing the downloaded bytes. Verification/network failures are errors, not "up to date" or "ready to install".
- After Download update, the only remaining action is Restart to update. That click installs the verified update and restarts the app without a separate installation confirmation. Running and queued transfers block it; the backend rechecks shared task state while holding a gate against desktop starts/resumes. The idle sidecar must exit before replacement, and cannot respawn until restart or an installation failure.
- On Windows, the installer may close/relaunch the application. On macOS/Linux, the UI invokes restart immediately after installation succeeds. A failed installation remains retryable; a failed restart retries only restart, without reinstalling. Restart cannot be called through the native command before an update is installed. Existing CLI processes are not stopped.
- Linux in-app updates require the AppImage. `.deb` installations display that limitation and should be updated through their package manager.
- No broad updater/plugin-process permissions are granted to JavaScript. The UI uses the guarded native `app_update_info`, `check_app_update`, `download_app_update`, `install_app_update`, and `restart_after_update` commands.

## Recovery and Verification

If npm succeeded but a desktop build failed, the release remains a draft. Re-running Publish may skip the already-published npm version. Instead dispatch **Desktop Release** with its existing `vX.Y.Z` tag and `publish=true` to rebuild/finish that draft. This checks out the tag, validates its version, and refuses to modify an already-public release. Code fixes require a new version; never move a release tag.

Local coverage includes release manifest completeness, artifact naming, signature presence, version alignment, native idle-transfer checks, actual sidecar shutdown, valid/wrong-key/tampered signature checks, and mocked browser update flows. These checks do not replace testing real signed upgrades on Windows, Linux, and both macOS architectures. The signature test uses temporary keys and never installs an update.

References: [croc-gui release workflow](https://github.com/Carlos-err406/croc-gui/blob/main/.github/workflows/release.yml), [Tauri updater](https://v2.tauri.app/plugin/updater/), [tauri-action](https://github.com/tauri-apps/tauri-action).
