# GitFlare competition demo

**Your code. Your agents. Your platform.**

## Opening
“GitFlare lets people describe what they want to build. AI agents plan and implement the work, and the person reviews the result before it becomes their project.”

## Judging journey
1. Open the existing competition Worker URL and sign in with a demo/test email.
2. Show Your Projects, then create, upload, or import a small project.
3. Open Project Home and browse Files, Understand, and Updates.
4. Ask for a small change. Show planning, workstreams, safety checks, integration, and project checks.
5. Review the combined update and explain what changed. Request a revision if needed.
6. Choose Use this update, verify the canonical files/history, and deploy the approved version.
7. Open the live result.

## Architecture talking points
Cloudflare Artifacts stores canonical and isolated agent repositories. Workers provides the application; D1 stores accounts and project state; KV stores mission state; Cloudflare Sandbox runs implementation and checks. Humans retain the acceptance decision.

## Close
“GitFlare: Your code. Your agents. Your platform.”

Use only capabilities verified in the deployed build. Follow COMPETITION_E2E.md for live acceptance; do not describe build or smoke-test success as complete E2E coverage. Existing infrastructure names and historical demo artifacts can still use NextGit for compatibility.
