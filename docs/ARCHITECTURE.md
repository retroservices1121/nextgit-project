# Architecture

## Boundary

The production platform must not require GitHub or GitLab. Git-compatible storage/versioning exists beneath the product UX through Cloudflare Artifacts.

## Control flow

```text
Human
  |
  v
Mission
  |
  +--> Attempt A (isolated repository) --+
  +--> Attempt B (isolated repository) --+--> Security/Test supervision
  +--> Attempt C (isolated repository) --+
                                           |
                                           v
                                      Comparison
                                           |
                                           v
                                    Human Decision
                                           |
                                           v
                                  Canonical Project
                                           |
                                           v
                                        Release
```

## Agent roles

### Implementation Agent
Works toward the Mission objective inside an isolated Attempt.

### Security Agent
Supervisory role. Observes changes across Attempts, creates structured findings, and can send remediation context to active implementation agents. High/critical unresolved findings block an Attempt from advancing to a release decision.

### Test Agent
Builds and exercises an Attempt and reports objective results.

### Review Agent
Summarizes material architectural and implementation differences for the human. It does not choose the winning Attempt.

## Human authority

The system may block unsafe release paths according to explicit policy, but it does not silently select an implementation. Acceptance/rejection/revision is represented as a Decision.

## Infrastructure adapters

Infrastructure-specific APIs should remain behind adapters so the domain model does not become Cloudflare- or model-provider-specific even though the competition implementation is Cloudflare-native.
