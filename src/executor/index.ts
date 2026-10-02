import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

interface ArtifactRepoInfo {
  name?: string;
  remote?: string;
}

interface ArtifactRepo {
  info(): Promise<ArtifactRepoInfo>;
  createToken(scope: "write", ttl: number): Promise<{ plaintext: string }>;
}

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ARTIFACTS: { get(name: string): Promise<ArtifactRepo> };
  OPENAI_API_KEY?: string;
  AGENT_MODEL?: string;
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

    if (url.pathname === "/ai-agent-proof") {
      try {
        if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

        const repo = await env.ARTIFACTS.get("e2e-attempt-b");
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 900);
        const sandbox = getSandbox(env.Sandbox, "ai-agent-proof-b");
        await sandbox.setEnvVars({
          ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext),
        });

        const setup = await sandbox.exec([
          "cd /workspace",
          "rm -rf ai-project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" ai-project",
          "cd ai-project",
          "git config user.name 'NextGit AI Agent B'",
          "git config user.email 'agent-b@nextgit.local'",
        ].join(" && "));
        if (setup.exitCode !== 0) {
          return json({ ok: false, stage: "clone", stdout: setup.stdout, stderr: setup.stderr }, 500);
        }

        const listing = await sandbox.exec("cd /workspace/ai-project && find . -maxdepth 2 -type f -not -path './.git/*' | sort | head -80");
        const prompt = [
          "You are Agent B in an isolated software-development attempt.",
          "Mission: add a small proof file named AI_AGENT_PROOF.md.",
          "Return ONLY the complete Markdown contents for that file.",
          "The file must explain in 2-4 sentences that an AI implementation agent chose and authored this change inside an isolated Cloudflare Sandbox.",
          "Do not use code fences.",
          "Repository file sample:",
          listing.stdout ?? "",
        ].join("\n");

        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "authorization": `Bearer ${env.OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: env.AGENT_MODEL ?? "gpt-5.2",
            input: prompt,
            max_output_tokens: 300,
          }),
        });

        const payload = await response.json() as any;
        if (!response.ok) {
          return json({ ok: false, stage: "model", status: response.status, error: payload?.error?.message ?? "Model request failed" }, 500);
        }

        const text = payload.output_text ??
          payload.output?.flatMap((item: any) => item.content ?? [])
            ?.find((part: any) => part.type === "output_text")?.text;
        if (!text) throw new Error("Model returned no text.");

        await sandbox.setEnvVars({ NEXTGIT_AGENT_OUTPUT: text });
        const write = await sandbox.exec([
          "cd /workspace/ai-project",
          "printf '%s\\n' \"$NEXTGIT_AGENT_OUTPUT\" > AI_AGENT_PROOF.md",
          "git add AI_AGENT_PROOF.md",
          "git commit -m 'agent-b: AI-authored proof'",
          "git push origin HEAD",
          "git rev-parse --short HEAD",
        ].join(" && "));

        return json({
          ok: write.exitCode === 0,
          agent: "agent-b",
          model: env.AGENT_MODEL ?? "gpt-5.2",
          repository: "e2e-attempt-b",
          exitCode: write.exitCode,
          stdout: write.stdout,
          stderr: write.stderr,
        }, write.exitCode === 0 ? 200 : 500);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "AI Agent proof failed" }, 500);
      }
    }

    if (url.pathname === "/agent-proof") {
      try {
        const repo = await env.ARTIFACTS.get("e2e-attempt-a");
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 900);
        const sandbox = getSandbox(env.Sandbox, "agent-proof-a");
        await sandbox.setEnvVars({
          ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext),
        });

        const result = await sandbox.exec([
          "cd /workspace",
          "rm -rf agent-project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" agent-project",
          "cd agent-project",
          "git config user.name 'NextGit Agent A'",
          "git config user.email 'agent-a@nextgit.local'",
          "printf '%s\\n' '# NextGit Agent Proof' '' 'Created by Agent A inside an isolated Cloudflare Sandbox and pushed to a Cloudflare Artifacts Attempt repository.' > E2E_AGENT_PROOF.md",
          "git add E2E_AGENT_PROOF.md",
          "git commit -m 'agent-a: add E2E proof'",
          "git push origin HEAD",
          "git rev-parse --short HEAD",
        ].join(" && "));

        return json({
          ok: result.exitCode === 0,
          agent: "agent-a",
          repository: "e2e-attempt-a",
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }, result.exitCode === 0 ? 200 : 500);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Agent proof failed" }, 500);
      }
    }

    if (url.pathname === "/artifacts-proof") {
      try {
        const repo = await env.ARTIFACTS.get("e2e-attempt-a");
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 900);
        const sandbox = getSandbox(env.Sandbox, "artifacts-proof-a");
        await sandbox.setEnvVars({
          ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext),
        });
        const result = await sandbox.exec([
          "cd /workspace",
          "rm -rf project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" project",
          "cd project",
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
