# Event-driven supervision

Cloudflare Artifacts exposes repository lifecycle events, including `pushed`.

The production security path will subscribe to pushes from Attempt repositories so security review is event-driven:

```text
Implementation Agent
      |
      | git push
      v
Artifacts Attempt repository
      |
      | cf.artifacts.repo.pushed
      v
Security / CI workflow
      |
      +--> deterministic scan
      +--> contextual Security Agent
      +--> tests
      |
      v
Finding + Attempt status
```

This avoids polling agent workspaces and makes supervisory agents reactive to actual repository changes.

The Worker has Cloudflare observability enabled so Mission execution and infrastructure failures can be traced during the competition demo.
