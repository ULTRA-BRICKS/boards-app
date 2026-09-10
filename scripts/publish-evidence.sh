#!/usr/bin/env bash
# Publish only public fixture screenshots after successful main quality checks.
set -euo pipefail
: "${EVIDENCE_DIR:?Missing artifact}"
: "${GITHUB_SHA:?Missing commit}"
: "${GITHUB_RUN_ID:?Missing run}"
: "${GITHUB_REPOSITORY:?Missing repository}"
: "${GITHUB_SERVER_URL:?Missing server URL}"
[[ ${GITHUB_EVENT_NAME:-} == push && ${GITHUB_REF:-} == refs/heads/main ]] || exit 1
[[ $GITHUB_SHA =~ ^[0-9a-f]{40}$ && $GITHUB_RUN_ID =~ ^[0-9]+$ ]] || exit 1
names=(board-desktop.png board-mobile-viewport.png type-site.png photo-review.png page-thumbnails.png)
for name in "${names[@]}"; do
  test -f "$EVIDENCE_DIR/docs/screenshots/$name"
  test ! -L "$EVIDENCE_DIR/docs/screenshots/$name"
done
source_dir=$(mktemp -d)
trap 'rm -rf "$source_dir"' EXIT
for name in "${names[@]}"; do cp "$EVIDENCE_DIR/docs/screenshots/$name" "$source_dir/$name"; done
cp "$EVIDENCE_DIR/test-results/browser-chromium.json" "$source_dir/browser-verification.json"
bun scripts/bundle-type.mjs
cp dist/type-standalone/index.html "$source_dir/type-site.html"
if git ls-remote --exit-code --heads origin visual-evidence >/dev/null; then
  git fetch --depth=1 origin refs/heads/visual-evidence
  git checkout -B visual-evidence FETCH_HEAD
else
  status=$?
  [[ $status == 2 ]] || exit "$status"
  git checkout --orphan visual-evidence
  git rm -rf --ignore-unmatch .
fi
mkdir -p screenshots
cp "$source_dir"/*.png screenshots/
cp "$source_dir/browser-verification.json" .
cp "$source_dir/type-site.html" .
printf '{"sourceCommit":"%s","run":"%s/%s/actions/runs/%s","mode":"Bun + native Chromium; public fixtures only"}\n' "$GITHUB_SHA" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID" > evidence.json
printf '# Visual evidence\n\nActual browser screenshots. Source/run are in [evidence.json](evidence.json). No private accounts, credentials, databases or font binaries are included.\n\n![Board](screenshots/board-desktop.png)\n' > README.md
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add screenshots browser-verification.json evidence.json README.md type-site.html
git diff --cached --quiet && exit 0
git commit -m "docs: render verified UI for ${GITHUB_SHA:0:12}"
git push origin HEAD:refs/heads/visual-evidence
