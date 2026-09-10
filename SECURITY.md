# Security boundaries

This is an experimental single-workspace application, not an independently audited identity platform. Verify real provider flows before inviting a wider audience.

- Do not commit `.env.local`, `.seed-people.json`, `.data`, provider tokens, private contact exports or screenshots showing private people/tasks.
- Production must have Neon, an exact HTTPS `APP_ORIGIN`, an owner email and at least one working login provider. Missing configuration closes the board. SQLite/test login are opt-in and disabled when `VERCEL` is set.
- Login admission is invite-only. Google/GitHub/Slack accounts are uniquely owned by their provider subjects. Matching email does not automatically merge OAuth accounts. Recent login plus provider proof is required for linking.
- Third-party account-link suggestions do not grant account access. A proposed avatar is visible only to its uploader and owner until confirmation. Other people cannot replace an existing photo.
- Session/OAuth/email token values are hashed in storage. Credentials and provider access tokens are never included in workspace JSON. Sign-in provider access tokens are not retained for integration use.
- Writes check origin. OAuth callback is a deliberate exception guarded by one-time state, nonce and a separate browser-binding cookie. Slack's cross-site form callback is supported with a Secure SameSite=None binding cookie.
- Read-only share capabilities are bearer secrets. They disclose their selected content and optionally adjacent tasks to anyone with the link and to preview crawlers. They do not grant editing or expose identity records. Revocation stops future authorized reads, not screenshots or cached previews.
- Only known HTTPS avatar hosts are fetched; redirects, credentials in URLs and nonstandard ports are refused. Uploads accept bounded PNG/JPEG/WebP bytes, not SVG/HTML. Source URLs are not arbitrary server-side fetch targets.
- Stored assets are currently in JSONB/base64, appropriate only for a small experiment. A larger deployment should use bounded object storage, malware/image-dimension validation and stronger retention/cleanup policies.
- Provider-specific scopes, sender-domain verification, production OAuth application review, backups, account recovery, stronger global rate limiting and abuse monitoring remain operator responsibilities.
- The identity store uses atomic CAS but whole-workspace writes are not CRDT merges. Concurrent conflicting edits block rather than silently overwrite.
- Generation and email ceilings are application limits, not billing guarantees for other uses of the same provider account.
- Built-in public UI has no HTML user-content execution path. Ticket/vision text is escaped and is never executed as instructions.

Report a suspected vulnerability privately to the repository owner; do not post credentials in public issues.
