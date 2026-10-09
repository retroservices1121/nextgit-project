import { DurableObject } from "cloudflare:workers";

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const WORKSPACE = "/workspace/project";

export interface AgentSandboxEnv {}

export class AgentSandbox extends DurableObject<AgentSandboxEnv> {
  private readonly container: any;

  constructor(ctx: DurableObjectState, env: AgentSandboxEnv) {
    super(ctx, env);
    if (!ctx.container) {
      throw new Error("Container binding is not configured.");
    }
    this.container = ctx.container;

    if (this.container.running) {
      void ctx.blockConcurrencyWhile(() =>
        this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  private async ensureRunning(): Promise<void> {
    if (!this.container.running) {
      this.container.start({
        image: this.container.images.workspace,
        instance: "lite",
        enableInternet: true,
      });
    }

    await this.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
  }

  async run(argv: string[], env: Record<string, string> = {}) {
    await this.ensureRunning();
    const process = await this.container.exec(argv, { env });
    const output = await process.output();
    const decoder = new TextDecoder();

    return {
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }

  async prepareAttempt(input: {
    remote: string;
    token: string;
    branch?: string;
  }) {
    await this.ensureRunning();

    // Use GIT_ASKPASS so the repo token is never embedded in the remote URL,
    // shell command, Mission history, or process arguments.
    const script = [
      "set -eu",
      "rm -rf /workspace/project",
      "cat > /tmp/git-askpass.sh <<'EOF'",
      "#!/bin/sh",
      "case \"$1\" in",
      "  *Username*) printf '%s\\n' x ;;",
      "  *Password*) printf '%s\\n' \"$ARTIFACT_REPO_TOKEN\" ;;",
      "  *) printf '\\n' ;;",
      "esac",
      "EOF",
      "chmod 700 /tmp/git-askpass.sh",
      "GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/tmp/git-askpass.sh git clone --branch \"$ARTIFACT_BRANCH\" --single-branch \"$ARTIFACT_REMOTE\" /workspace/project",
      "cd /workspace/project",
      "git config user.name 'GitFlare Agent'",
      "git config user.email 'agent@nextgit.local'",
      "git status --short",
    ].join("\n");

    return this.run(
      ["sh", "-lc", script],
      {
        ARTIFACT_REMOTE: input.remote,
        ARTIFACT_REPO_TOKEN: input.token,
        ARTIFACT_BRANCH: input.branch ?? "main",
      },
    );
  }

  async destroy() {
    if (this.container.running) {
      await this.container.destroy();
    }
  }
}
