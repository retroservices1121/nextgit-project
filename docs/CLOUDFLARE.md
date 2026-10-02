# Cloudflare implementation

## Live infrastructure

Artifacts namespace: `nextgit`

The namespace is provisioned in the Cloudflare account used for the competition build.

### First infrastructure proof

A canonical repository named `demo-project` was created through the Cloudflare Artifacts REST API.

Two isolated repositories were then forked from that canonical repository:

- `attempt-demo-agent-a`
- `attempt-demo-agent-b`

This proves the central storage primitive of the MVP: a Mission can give each implementation agent an isolated Git-compatible repository without creating GitHub branches or pull requests.

## Worker binding

The Worker is configured with:

```jsonc
"artifacts": [
  {
    "binding": "ARTIFACTS",
    "namespace": "nextgit"
  }
]
```

The application uses this binding rather than GitHub as its runtime repository control plane.

## Repository lifecycle

```text
Project created
      |
      v
Canonical Artifacts repository
      |
Mission launched
      |
      +---- fork ----> Attempt A repository
      |
      +---- fork ----> Attempt B repository
      |
      +---- fork ----> Attempt C repository
```

Attempts are disposable/isolate-able working states. Only an explicit Decision may promote an Attempt back toward canonical project state.
