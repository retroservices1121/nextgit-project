# NextGit — Cloudflare Competition 100% Checklist

## P0 — Core competition architecture
- [ ] Dependency-aware agent inheritance: downstream workstreams start from completed dependency output, not stale canonical
- [ ] Mixed/parallel/sequential scheduler verified end-to-end
- [ ] Integration handles multiple safe workstreams reliably
- [ ] Integration conflict path is safe and understandable
- [ ] Per-workstream Security Agent gate
- [ ] Final integrated Security Agent gate
- [ ] Project tests/checks gate before approval
- [ ] Human approval is the only path to canonical promotion
- [ ] Clef-flash decisions visibly affect orchestration

## P0 — Complete nontechnical user journey
- [ ] Sign in
- [ ] Your Projects dashboard
- [ ] Start new project
- [ ] Upload folder/files with preserved paths
- [ ] Import existing public Git project
- [ ] Project understanding after upload/import
- [ ] Plain-English Build request from Project Home
- [ ] Conversational clarification without restarting Mission
- [ ] Visible build progress: Plan → Work → Safety → Integration → Tests
- [ ] Review one integrated update
- [ ] See what changed in understandable form
- [ ] Real Ask for changes/revision loop
- [ ] Use this update
- [ ] Return to updated Project Home

## P0 — Code hosting
- [x] Canonical Cloudflare Artifacts repository per Project
- [x] Recursive Files browser
- [x] Understand / Code file views
- [x] Human-readable Updates history
- [x] Developer details on demand
- [x] Standard Git access for authorized owner/editor
- [x] No arbitrary repository identifiers trusted from browser

## P0 — Accounts and tenant safety
- [ ] D1 users/projects/missions/sessions model
- [ ] Project ownership
- [ ] Owner/editor authorization on writes
- [ ] Authorization on reads/file explanations/diffs/review
- [ ] Mission/workspace ownership validation
- [ ] Final apply authorization
- [ ] Replace prototype email identity with competition-safe authentication or clearly constrain demo accounts
- [ ] Rate/size limits on uploads and AI execution

## P0 — Deployment
- [ ] Deploy tab in Project Home
- [ ] Provider abstraction
- [ ] One real Cloudflare deployment path
- [ ] Deployment status + live URL
- [ ] Deploy only approved canonical version
- [ ] Environment/secrets handling documented and safe
- [ ] Vercel/Railway shown only as future providers unless actually implemented

## P0 — Reliability / E2E
- [ ] New account → new Project clean-room test
- [ ] Upload-project E2E
- [ ] Import-project E2E
- [ ] Simple one-workstream change E2E
- [ ] Parallel multi-workstream change E2E
- [ ] Mixed dependency change E2E
- [ ] Clarification E2E
- [ ] Security-blocked change E2E
- [ ] Failed-test change E2E
- [ ] Apply + verify canonical changed
- [ ] Deploy + verify live result
- [ ] Repeat complete golden path at least 3 times without manual repair

## P1 — Competition presentation
- [ ] Competition-specific landing/demo entry
- [ ] Explain why this rethinks branches/PRs/merge conflicts for AI builders
- [ ] Architecture diagram
- [ ] Clearly identify Cloudflare products used
- [ ] Demo seed project that finishes quickly and predictably
- [ ] 2–3 minute demo script
- [ ] Backup recorded demo
- [ ] README with setup, architecture, judging path, limitations
- [ ] No secrets/personal data in repository
- [ ] Final submission requirements checked against current competition rules

## Freeze rule
After every P0 item is green, stop adding product features. Only fix bugs, improve demo clarity, document architecture, and run E2E tests until submission.
