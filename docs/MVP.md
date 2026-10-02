# Competition MVP

## Required demo path

1. User creates a Project.
2. User describes a Mission.
3. Orchestrator creates at least two isolated Attempts.
4. Implementation agents begin concurrently.
5. Activity is visible in the Mission UI.
6. Security Agent inspects changes while implementation is active.
7. A security finding can be delivered back to the affected Attempt for remediation.
8. Test results and security findings are attached to each Attempt.
9. User compares completed Attempts.
10. User accepts, rejects, or requests revision.
11. Accepted Attempt becomes canonical project state.
12. System shows a Release.

## Demo acceptance criteria

- No GitHub API is used by the product runtime.
- At least two implementation agents demonstrably operate concurrently.
- Attempts do not write directly to canonical state.
- Security review produces structured, file-specific findings.
- Unresolved high/critical findings cannot be released.
- The human makes the final implementation decision.
- Mission history preserves the objective, Attempts, findings, tests, and Decision.

## Explicitly out of scope before competition submission

- Billing
- Marketplace
- Enterprise SSO
- Large organization administration
- Mobile app
- Full GitHub feature parity
- Hundreds of agents
- Custom domain
