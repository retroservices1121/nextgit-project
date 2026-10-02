# Agent runtime

The first implementation harness is now wired end-to-end in application code.

## Flow

```text
Attempt
  |
  v
mint 30-minute Artifacts write token
  |
  v
named AgentSandbox Durable Object
  |
  v
clone isolated Attempt repository
  |
  v
Mastra implementation agent
  |
  +--> read-file
  +--> list-files
  +--> write-file
  +--> run-command
  |
  v
git commit + push
  |
  v
revoke repository token
```

The default configured model is `openai/gpt-5.6-sol`, supplied to Mastra as a model identifier. Provider credentials are never committed to source control and must be configured as Worker secrets before model-backed execution is enabled.

Repository credentials are also short-lived and are passed to Git through `GIT_ASKPASS`; they are not embedded in remotes or persisted in Mission history.
