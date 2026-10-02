# Capability isolation

Each implementation Attempt receives a short-lived, repository-scoped Artifacts token.

## Rules

- Implementation agents receive **write** access only to their own Attempt repository.
- They receive no write credential for the canonical Project repository.
- Security/Test agents should use **read** capabilities unless remediation requires an explicit delegated write.
- Tokens should be short lived and minted just-in-time.
- Plaintext repository tokens must never be logged or persisted in Mission history.

## Infrastructure proof

On October 2, 2026, the competition environment successfully minted independent one-hour write capabilities for:

- `attempt-demo-agent-a`
- `attempt-demo-agent-b`

The token values were intentionally not stored in source or documentation.

This demonstrates that parallel agents can be granted independent write authority without sharing a repository credential.
