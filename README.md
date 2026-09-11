# Boards static publication

Prepared static files for GitHub Pages, copied from main aa4d587. This is not a separate backend or a merge of the unfinished Bun migration.

## Enable once

Repository Settings → Pages → Source: **Deploy from a branch** → branch **gh-pages** → **/(root)** → Save.

Expected notebook URL after GitHub reports a successful deployment: https://ultrabricks.github.io/boards-app/

Expected separate type specimen: https://ultrabricks.github.io/boards-app/type.html

Do not call these live until Pages deployment succeeds. The previous githack address was reported as 404 and is not a verified fallback.

All CSS and modules are served from this branch. The notebook's original absolute import identifiers are mapped to same-origin modules in index.html before the app loads. This does not request files from githack. The existing isolated Neon prototype API remains external; no team database credentials or font binaries are published.

The private editing capability remains in #key=... . Use Share for a read-only link. Hosted end-to-end, account authentication, integrations, AI and production release gates are not implied by preparing these files.
