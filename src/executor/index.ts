import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

interface ArtifactRepo {
  name?: string;
  remote: string;
  createToken(scope: "write", ttl: number): Promise<{ plaintext: string }>;
}

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ARTIFACTS: { get(name: string): Promise<ArtifactRepo> };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

function authenticatedRemote(remote: string, token: string) {
  const secret = token.split("?expires=")[0];
  return `https://x:${secret}@${remote.slice("https://".length)}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "nextgit-executor", runtime: "sandbox-stable", artifacts: "bound" });
    }

    if (url.pathname === "/sandbox-proof") {
      const sandbox = getSandbox(env.Sandbox, "bootstrap-proof");
      const result = await sandbox.exec("git --version && node --version && pwd");
      return json({ ok: result.exitCode === 0, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, result.exitCode === 0 ? 200 : 500);
    }

    if (url.pathname === "/artifacts-proof") {
      try {
        const repo = await env.ARTIFACTS.get("e2e-attempt-a");
        const token = await repo.createToken("write", 900);
        const sandbox = getSandbox(env.Sandbox, "artifacts-proof-a");
        await sandbox.setEnvVars({
          ARTIFACTS_GIT_REMOTE: authenticatedRemote(repo.remote, token.plaintext),
        });
        const result = await sandbox.exec([
          "rm -rf /workspace/project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" /workspace/project",
          "cd /workspace/project",
          "git rev-parse --is-inside-work-tree",
          "git log -1 --oneline",
        ].join(" && "));
        return json({
          ok: result.exitCode === 0,
          repository: "e2e-attempt-a",
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }, result.exitCode === 0 ? 200 : 500);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Artifacts proof failed" }, 500);
      }
    }

    return json({ service: "nextgit-executor", endpoints: ["GET /health", "GET /sandbox-proof", "GET /artifacts-proof"] });
  },
};
