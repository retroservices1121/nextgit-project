# GitFlare

**Your code. Your agents. Your platform.**

Working repository for an agent-native software development platform being built for Cloudflare's "What Comes After Git?" competition.

> GitFlare is the product name. Existing infrastructure and the `retroservices1121/nextgit-project` repository retain their current identifiers for competition compatibility.

## Product thesis

Traditional developer platforms are organized around humans manipulating branches, commits, issues, and pull requests. This project explores a different model: humans define intent and make decisions while specialized agents perform implementation, security review, testing, and analysis concurrently.

### Core primitives

- **Project** — canonical software product and source state.
- **Mission** — a human-defined outcome to accomplish.
- **Attempt** — an isolated implementation of a Mission by an agent.
- **Finding** — a structured observation from a supervisory agent such as Security.
- **Decision** — the human choice about an Attempt or requested remediation.
- **Release** — accepted canonical state prepared for deployment.

## Competition MVP

1. Create a Project.
2. Create a Mission.
3. Launch multiple implementation Attempts concurrently.
4. Keep each Attempt isolated.
5. Continuously inspect changes with a Security Agent.
6. Run tests/review on completed Attempts.
7. Compare implementations and findings.
8. Require a human Decision.
9. Promote the accepted Attempt to canonical project state.
10. Produce a Release.

## Architecture

- **Cloudflare Artifacts** — repository/versioning infrastructure.
- **Cloudflare Workers / Durable Objects** — application, coordination, events, and state.
- **Mastra (Apache-licensed components)** — agent/workflow orchestration.
- **Model providers** — pluggable implementation and supervisory agents.

GitHub is used to develop and publish the competition submission. It is **not** a required production dependency of the platform.

## Development principles

- Git is an implementation detail, not the primary user experience.
- Agents may implement; supervisory agents inspect.
- Security is continuous, not a final checkbox.
- Humans retain consequential merge/release decisions.
- Provider-specific model integrations stay replaceable.
- Secrets never belong in source control.

## Status

Foundation / competition MVP under active development.


## Branding and validation

GitFlare uses the tagline **Your code. Your agents. Your platform.** See [Branding compatibility](docs/BRANDING.md) for retained infrastructure identifiers and historical references, and [Demo script](docs/DEMO_SCRIPT.md) for the judging journey.

Run `npm install`, `npm run typecheck`, `npm run build`, `npm run build:executor`, and `npm test`. The deployment workflow also checks the Worker bundle before deploying and verifies public branding, browser script syntax, health, and sign-in redirects afterward. These checks do not substitute for the [live competition E2E matrix](docs/COMPETITION_E2E.md).
