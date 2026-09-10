# Architecture and design decisions

## Paper, not a dashboard

The original poster was dominated by three large hand-lettered headings, freely placed pen illustrations, narrow blue dividers and warm negative space. The old prototype lost that hierarchy behind application toolbars and smaller type. The new board has no app header or brand. The small board title belongs to the sheet itself.

Controls are folded into a few notebook-edge bookmarks: pages/columns, search, sharing and profile/settings. These expose labels on desktop hover/focus and become a labeled lower-edge tool strip on touch screens. This is intentionally not a hidden-gesture-only interface. Column shortcuts remain in Pages. Keyboard search is Cmd/Ctrl+K; Escape closes overlays; focus is trapped in dialogs and returned afterward. Reduced-motion preferences are respected.

Avatars occupy a trailing grid track instead of a line below text. The dashed add-avatar affordance appears on hover/focus and remains visible on touch. When no photo can be fetched, an image silhouette is shown, not a made-up real portrait or initial badge. Provider photos are proxied only from explicitly allowed HTTPS CDNs.

`apps/type-site` is independently built and deployed. Shared source is limited to original glyph geometry/compiler; its output never includes the board API or records.

## State and identity

One workspace per deployment, many boards. `conloca_board` remains a versioned JSON document for compatibility. `boards_records(namespace,id)` keeps identity, session, asset, invitation-proposal, vector, ticket-cache, comment-delivery and share records separate. Writes are parameterized SQL with atomic compare-and-swap. A stale editor receives 409 and must resolve the conflict. This is not real-time CRDT collaboration.

Workspace PUT cannot replace canonical people, identities, avatars or integrations. Dedicated routes validate those changes. OAuth subjects are unique and mapped independently of directory emails. Account linking requires explicit proof. Avatar proposals preserve immediate uploader feedback without publishing an unapproved image to everyone.

Opaque random session tokens are stored only as SHA-256 hashes. State, nonce, browser binding, PKCE where supported, short-lived one-use OAuth/email tokens, origin checks, secure cookies and server-side rate counters guard the main flows. See SECURITY.md for scope and remaining deployment obligations.

## Search

The referenced state-lib search uses a lazily built client-side Orama index, title boost and typo tolerance; it does not compute semantic vectors. This board instead needs shared server-side scope, duplicates and illustration search.

For the current bounded corpus, a small tested BM25 scorer plus cosine vectors is sufficient. RRF combines lexical and semantic rankings, with a bounded boost for the current board and column. Exact task matches always outrank context-only advantages. Duplicate checks exclude the edited task and use symmetric embedding mode. If embeddings fail, results explicitly say lexical mode; no random/hash vectors masquerade as meaning.

Cloudflare BGE-M3, HTTP multilingual-E5 and Ollama providers implement the same batch boundary. A provider/model/version/mode/text hash keys persisted vectors. E5's query/passage prefixes live in the Python sidecar, not scattered through the UI. The optional Python service uses uv and MPS, but is not necessary on Vercel.

This is not an Elasticsearch/Solr/Typesense cluster. Nor does it install a large scraping/reranking/search stack for a few hundred tasks. When the corpus or number of workspaces warrants it, replace the exact scan behind this boundary with PostgreSQL full-text + pgvector/HNSW; add an evaluated reranker only after measuring recall/latency. The current caps and exact scan are explicit limitations.

## Illustrations and photo intake

A common collection contains original vector doodles plus generated images, each with title, description and keywords. Selection checks exact cached requests, then semantic similarity; missing images invoke the configured generator with a bounded daily counter and concurrent-request guard. Source metadata and binary assets remain in cloud storage, not Git.

Photo intake uses a separate vision boundary. Text in the photograph is untrusted data. The model returns validated draft JSON and uncertainty notes. A human reviews/edits it before a different API action creates a board. Assignee hints do not become unverified identities.

## Sharing

A random, revocable capability grants read access to a validated workspace/board/column/item/selection scope. The URL contains no serialized workspace. Every read projects the latest saved state. Neighbor disclosure is opt-in; private email, Slack IDs and identity records are stripped. A shared generated illustration is served only if it belongs to an included column.

PNG rendering is deterministic and does not need an LLM, an installed font or a browser binary: the original glyph contours and illustration paths are rasterized into a 1200×630 image. Focus text is reflowed into the available width and nearby tasks are faded. Item previews include board and column names, not the workspace name. HTML metadata is server-rendered for crawlers. Messenger caches may still retain older screenshots or revoked content.

Playwright is used for visual/browser testing, not request-time previews: this avoids a large Chromium cold-start dependency in each serverless function. A browser-rendering provider could replace the preview renderer later without changing share authorization.
