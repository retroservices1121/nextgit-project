# NextGit Competition E2E Test Matrix

Run against the deployed competition environment. Do not mark a scenario passed from unit/build success alone.

| Scenario | Expected result |
|---|---|
| New account → Project | Account session created, Project appears in Your Projects, canonical Artifacts repo exists |
| Upload Project | Paths preserved, project analysis succeeds, files browsable |
| Import public Git Project | Canonical Artifacts import succeeds, files/history visible |
| Simple change | One coherent update reaches review and can be applied |
| Parallel change | Independent workstreams execute concurrently and integrate |
| Mixed dependency change | Downstream work inherits completed dependency code |
| Clarification | Same Mission resumes after user supplies detail |
| Secret/security test | Unsafe change is blocked before canonical promotion |
| Failing project test | Review cannot apply failing integrated update |
| Revision | Ask for changes creates a new checked revision |
| Canonical verification | Approved change is visible in Files/Updates after apply |
| Cloudflare deployment | Approved canonical version deploys and returns a reachable live URL |

## Golden path acceptance
Run the full account → Project → Build → Review → Apply → Deploy journey three times with no dashboard/manual repair.

For every run capture:
- Project ID
- Mission ID
- Clef execution decision
- workstream count
- per-workstream security result
- integration result
- final security result
- test result
- canonical apply result
- deployment ID + live URL

## Failure rule
A scenario is not green if a human must repair KV/D1/Artifacts state, manually alter a repository, rerun a hidden Cloudflare operation, or bypass a NextGit gate.
