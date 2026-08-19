# Homebrew Tap

The Homebrew formula lives at `Formula/visuales.rb`.

## Publish The Tap

The tap is published at:

```text
https://github.com/Carlos-err406/homebrew-visuales
```

Users install with:

```bash
brew tap Carlos-err406/visuales
brew install visuales
```

To recreate the tap from scratch, create a public GitHub repository named `homebrew-visuales`, then push the `Formula/` directory to it:

```bash
gh repo create Carlos-err406/homebrew-visuales --public
git clone https://github.com/Carlos-err406/homebrew-visuales.git
mkdir -p homebrew-visuales/Formula
cp Formula/visuales.rb homebrew-visuales/Formula/visuales.rb
cd homebrew-visuales
git add Formula/visuales.rb
git commit -m "Add visuales formula"
git push origin main
```

## Automatic Updates

When a GitHub Release is published, `.github/workflows/publish.yml` publishes the npm package, downloads the
published tarball, computes its SHA-256 checksum, updates `Formula/visuales.rb` in the tap, and pushes a commit to
`Carlos-err406/homebrew-visuales`.

Required repository secret:

```text
HOMEBREW_TAP_TOKEN
```

The token needs write access to `Carlos-err406/homebrew-visuales`.

## Manual Fallback

After publishing a new npm version:

```bash
VERSION=1.0.1
curl -L "https://registry.npmjs.org/visuales/-/visuales-${VERSION}.tgz" -o "/tmp/visuales-${VERSION}.tgz"
shasum -a 256 "/tmp/visuales-${VERSION}.tgz"
```

Update the formula `url` and `sha256`, then commit and push the tap.
