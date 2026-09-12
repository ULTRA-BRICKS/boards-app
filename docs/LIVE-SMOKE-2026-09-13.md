# Live Vercel checkpoint — 2026-09-13

- Site: https://boards-app-gamma.vercel.app/
- Type specimen: https://boards-app-gamma.vercel.app/type.html
- Vercel project: inventorems-projects/boards-app.
- Published static snapshot: gh-pages commit abb14aba78fa93f8cb7176dff77c07ddb1232325.
- Backend: existing isolated boards_prototype Neon Data API.
- Verification: real Chromium on the authorized Mac, launched with TypeScript Playwright via Bun.
- Public HTML, type HTML, app module and stylesheet returned HTTP 200.
- The page rendered 15 tasks using the real anonymous-token and RPC endpoints.
- A Unicode/emoji edit was saved with HTTP 200 and read in a second independent browser context.
- The task's original text was restored after the check.
- No fixture transport, request interception or disabled web security was used.
- No uncaught browser exceptions were observed in this flow.
- This check does not cover full production authentication, all CRUD/share flows, real team accounts or all release gates.
- Private editing-capability URLs were not put in screenshots, source or this report.
- The full Bun migration remains unmerged; a separate local verification is not a deployment of that migration.
