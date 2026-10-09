# GitFlare branding

**Your code. Your agents. Your platform.**

Use **GitFlare** in product UI, page titles, metadata, prompts, new generated Git author display names, and presentation copy.

## Compatibility identifiers retained

The GitHub repository remains `retroservices1121/nextgit-project`. Cloudflare Worker/service names remain `nextgit-project` and `nextgit-executor`, D1 remains `nextgit-app`, and the Artifacts namespace remains `nextgit`. Existing resource IDs, secrets, bindings, routes, deployment-name prefixes, and Artifacts repository names (including `nextgit-source`) are unchanged.

Session cookies (`nextgit_session`), E2E/request headers (`x-nextgit-e2e-key`, `x-nextgit-project-id`), browser state keys (`nextgit:lastMission`, `window.nextgitPending`), internal sandbox environment variables/markers, temporary paths, and synthetic Git email addresses retain their existing values. The fixed `NextGit E2E` response is retained as a competition compatibility fixture.

Historical user-created project names, Git commits, and already-generated demo files in Artifacts are stored data. This source rebrand does not rewrite them or alter the ongoing E2E repositories. New source-generated copy uses GitFlare; previously stored material may still say NextGit. The competition demo preview adapts the old product name to GitFlare at display time without rewriting those repositories.

## Verification

Run `npm install`, `npm run typecheck`, `npm run build`, `npm run build:executor`, `npm test`, and `npx wrangler deploy --dry-run`. The deployment workflow runs these checks before either production deployment. Route smoke tests use mocked D1 and verify rendered branding and inline JavaScript syntax; they do not replace the live competition E2E matrix.

No trademark clearance has been performed or claimed.
