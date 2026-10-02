# Agent model

## Implementation agents

A Mission launches two or more implementation agents concurrently. Each implementation agent receives:

- Mission objective
- isolated Artifacts repository
- its Attempt identity
- only the credentials/capabilities required for that Attempt

Implementation agents never receive write access to the canonical repository.

## Security Agent

Security is a supervisory agent, not a competing implementation.

The security pipeline has two layers:

1. **Deterministic checks** for credentials and dangerous constructs. These do not depend on an LLM.
2. **Agent review** for contextual security problems such as authorization gaps, unsafe trust boundaries, sensitive-data handling, and insecure architectural choices.

Findings are structured data. High and critical unresolved findings block eligibility for a release Decision.

## Why two security layers?

LLMs are useful security reviewers but should not be the sole control. Deterministic checks provide repeatable baseline enforcement while the Security Agent provides contextual analysis.

## Agent communication

The orchestration layer is designed so findings can later be signaled back to an active implementation agent for remediation before the Attempt is presented to the human.

## Human role

Agents may propose, implement, inspect, test, and remediate. The human retains the final acceptance/revision/rejection Decision.
