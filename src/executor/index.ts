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

    if (request.method === "POST" && url.pathname === "/plan-mission") {
      try {
        if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
        const body = await request.json() as { objective?: string; projectType?: string; maxWorkstreams?: number };
        if (!body.objective) return json({ ok: false, error: "objective is required" }, 400);
        const max = Math.max(1, Math.min(body.maxWorkstreams ?? 4, 6));
        const prompt = [
          "You are the planning lead for NextGit, a software platform designed primarily for non-technical people building with AI.",
          "Understand the user's intent. Break the request into independent implementation workstreams only when parallel work is genuinely useful.",
          "Do not split a simple request just to use more agents.",
          "Return JSON only with keys summary and tasks.",
          "tasks must be an array of objects with title, objective, mode, dependsOn.",
          "mode is parallel or sequence. dependsOn contains zero-based task indexes.",
          `Maximum workstreams: ${max}`,
          `Project type: ${body.projectType || "unknown software project"}`,
          `User request: ${body.objective}`,
        ].join("\n");
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ model: env.AGENT_MODEL ?? "gpt-5.2", input: prompt, max_output_tokens: 1200 }),
        });
        const payload = await response.json() as any;
        if (!response.ok) return json({ ok: false, error: payload?.error?.message ?? "Planner model failed" }, 500);
        const output = payload.output_text ?? payload.output?.flatMap((x: any) => x.content ?? [])?.find((x: any) => x.type === "output_text")?.text;
        if (!output) throw new Error("Planner returned no output.");
        const plan = JSON.parse(output);
        return json({ ok: true, plan });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Mission planning failed" }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/analyze-project") {
      try {
        const body = await request.json() as { repositoryName?: string };
        if (!body.repositoryName) return json({ ok: false, error: "repositoryName is required" }, 400);
        const repo = await env.ARTIFACTS.get(body.repositoryName);
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 600);
        const sandbox = getSandbox(env.Sandbox, `analyze-${body.repositoryName}`);
        await sandbox.setEnvVars({ ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext) });
        const result = await sandbox.exec([
          "cd /workspace",
          "rm -rf analyze-project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" analyze-project",
          "cd analyze-project",
          "COUNT=$(find . -type f -not -path './.git/*' | wc -l | tr -d ' ')",
          "TYPE='software project'",
          "if [ -f next.config.js ] || [ -f next.config.mjs ] || grep -q '\"next\"' package.json 2>/dev/null; then TYPE='Next.js web app'; elif [ -f vite.config.ts ] || [ -f vite.config.js ]; then TYPE='Vite web app'; elif grep -q '\"react\"' package.json 2>/dev/null; then TYPE='React app'; elif [ -f package.json ]; then TYPE='JavaScript or TypeScript project'; elif [ -f requirements.txt ] || [ -f pyproject.toml ]; then TYPE='Python project'; fi",
          "printf '%s|%s' \"$TYPE\" \"$COUNT\"",
        ].join("\n"));
        const [projectType, count] = (result.stdout || "software project|0").trim().split("|");
        return json({ ok: result.exitCode === 0, projectType, fileCount: Number(count || 0) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Project analysis failed" }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/upload-file") {
      try {
        const body = await request.json() as { repositoryName?: string; path?: string; contentBase64?: string; message?: string };
        if (!body.repositoryName || !body.path || body.contentBase64 === undefined) return json({ ok: false, error: "repositoryName, path, and contentBase64 are required" }, 400);
        const path = body.path.replace(/\\/g, "/");
        if (path.startsWith("/") || path.split("/").includes("..") || !path.trim()) return json({ ok: false, error: "Invalid repository path" }, 400);
        const repo = await env.ARTIFACTS.get(body.repositoryName);
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 900);
        const sandbox = getSandbox(env.Sandbox, `upload-${crypto.randomUUID()}`);
        await sandbox.setEnvVars({
          ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext),
          NEXTGIT_UPLOAD_PATH: path,
          NEXTGIT_UPLOAD_B64: body.contentBase64,
          NEXTGIT_UPLOAD_MESSAGE: body.message || `upload: ${path}`,
        });
        const result = await sandbox.exec([
          "cd /workspace",
          "rm -rf upload-project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" upload-project",
          "cd upload-project",
          "git config user.name 'NextGit User'",
          "git config user.email 'user@nextgit.local'",
          "mkdir -p \"$(dirname \"$NEXTGIT_UPLOAD_PATH\")\"",
          "printf '%s' \"$NEXTGIT_UPLOAD_B64\" | base64 -d > \"$NEXTGIT_UPLOAD_PATH\"",
          "git add -- \"$NEXTGIT_UPLOAD_PATH\"",
          "git commit -m \"$NEXTGIT_UPLOAD_MESSAGE\"",
          "git push origin HEAD",
          "git rev-parse HEAD",
        ].join(" && "));
        return json({ ok: result.exitCode === 0, repository: body.repositoryName, path, stdout: result.stdout, stderr: result.stderr }, result.exitCode === 0 ? 200 : 500);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Upload failed" }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/security-scan") {
      try {
        const body = await request.json() as { repositoryName?: string };
        if (!body.repositoryName) return json({ ok: false, error: "repositoryName is required" }, 400);
        const repo = await env.ARTIFACTS.get(body.repositoryName);
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 600);
        const sandbox = getSandbox(env.Sandbox, `security-${body.repositoryName}`);
        await sandbox.setEnvVars({ ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext) });
        const result = await sandbox.exec([
          "cd /workspace",
          "rm -rf security-project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" security-project",
          "cd security-project",
          "BASE=$(git rev-parse HEAD^ 2>/dev/null || true)",
          "FILES=$(git diff --name-only \"$BASE\" HEAD 2>/dev/null || git show --pretty='' --name-only HEAD)",
          "git diff \"$BASE\" HEAD 2>/dev/null > /tmp/nextgit.diff || git show --format= --patch HEAD > /tmp/nextgit.diff",
          "grep -En '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|password[[:space:]]*[:=][[:space:]]*[^[:space:]]+)' /tmp/nextgit.diff >/tmp/secret-findings 2>/dev/null && exit 42 || true",
          "printf '%s\\n' \"$FILES\" | grep -Eq '(^|/)([.]env($|[.])|id_rsa|id_ed25519|credentials[.]json)$' && exit 43 || true",
          "exit 0",
        ].join("\n"));
        const passed = result.exitCode === 0;
        return json({
          ok: true,
          passed,
          status: passed ? "pass" : "blocked",
          findings: passed ? [] : [{ severity: "high", message: result.exitCode === 43 ? "Sensitive credential file added or changed." : "Potential secret or private key detected in diff." }],
          scannedRepository: body.repositoryName,
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Security scan failed" }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/diff") {
      try {
        const body = await request.json() as { repositoryName?: string; baseRef?: string; headRef?: string };
        if (!body.repositoryName) return json({ ok: false, error: "repositoryName is required" }, 400);
        const repo = await env.ARTIFACTS.get(body.repositoryName);
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 600);
        const sandbox = getSandbox(env.Sandbox, `diff-${body.repositoryName}`);
        await sandbox.setEnvVars({ ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext) });
        const base = body.baseRef || "HEAD^";
        const head = body.headRef || "HEAD";
        const result = await sandbox.exec([
          "cd /workspace",
          "rm -rf diff-project",
          "git clone \"$ARTIFACTS_GIT_REMOTE\" diff-project",
          "cd diff-project",
          `git diff --stat ${base} ${head}`,
          `git diff --no-ext-diff --unified=3 ${base} ${head}`,
        ].join(" && "));
        return json({ ok: result.exitCode === 0, repository: body.repositoryName, stdout: result.stdout, stderr: result.stderr }, result.exitCode === 0 ? 200 : 500);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Diff failed" }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/promote") {
      try {
        const body = await request.json() as {
          sourceRepository?: string;
          targetRepository?: string;
          decisionId?: string;
        };
        if (!body.sourceRepository || !body.targetRepository || !body.decisionId) {
          return json({ ok: false, error: "sourceRepository, targetRepository, and decisionId are required" }, 400);
        }

        const source = await env.ARTIFACTS.get(body.sourceRepository);
        const target = await env.ARTIFACTS.get(body.targetRepository);
        const sourceInfo = await source.info();
        const targetInfo = await target.info();
        if (!sourceInfo.remote || !targetInfo.remote) throw new Error("Promotion repository remote missing.");

        const sourceToken = await source.createToken("write", 900);
        const targetToken = await target.createToken("write", 900);
        const sandbox = getSandbox(env.Sandbox, `promotion-${body.decisionId}`);
        await sandbox.setEnvVars({
          SOURCE_REMOTE: authenticatedRemote(sourceInfo.remote, sourceToken.plaintext),
          TARGET_REMOTE: authenticatedRemote(targetInfo.remote, targetToken.plaintext),
        });

        const result = await sandbox.exec([
          "cd /workspace",
          "rm -rf promotion-project",
          "git clone \"$SOURCE_REMOTE\" promotion-project",
          "cd promotion-project",
          "git remote add canonical \"$TARGET_REMOTE\"",
          "git fetch canonical main",
          "git merge-base --is-ancestor canonical/main HEAD",
          "git push canonical HEAD:main",
          "git rev-parse HEAD",
        ].join(" && "));

        return json({
          ok: result.exitCode === 0,
          sourceRepository: body.sourceRepository,
          targetRepository: body.targetRepository,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }, result.exitCode === 0 ? 200 : 409);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Promotion failed" }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/execute-attempt") {
      try {
        if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
        const body = await request.json() as {
          runId?: string;
          attemptId?: string;
          repositoryName?: string;
          agentId?: string;
          objective?: string;
        };
        if (!body.runId || !body.attemptId || !body.repositoryName || !body.agentId || !body.objective) {
          return json({ ok: false, error: "runId, attemptId, repositoryName, agentId, and objective are required" }, 400);
        }

        const repo = await env.ARTIFACTS.get(body.repositoryName);
        const info = await repo.info();
        if (!info.remote) throw new Error("Artifacts repository has no remote URL.");
        const token = await repo.createToken("write", 1800);
        const sandbox = getSandbox(env.Sandbox, `run-${body.runId}-${body.agentId}`);
        await sandbox.setEnvVars({
          ARTIFACTS_GIT_REMOTE: authenticatedRemote(info.remote, token.plaintext),
        });

        const setup = await sandbox.exec([
          "cd /workspace",
          `rm -rf ${body.attemptId}`,
          `git clone "$ARTIFACTS_GIT_REMOTE" ${body.attemptId}`,
          `cd ${body.attemptId}`,
          `git config user.name "NextGit ${body.agentId}"`,
          `git config user.email "${body.agentId}@nextgit.local"`,
        ].join(" && "));
        if (setup.exitCode !== 0) {
          return json({ ok: false, stage: "clone", stdout: setup.stdout, stderr: setup.stderr }, 500);
        }

        const root = `/workspace/${body.attemptId}`;
        const listing = await sandbox.exec(`cd ${root} && find . -maxdepth 3 -type f -not -path './.git/*' | sort | head -160`);
        const prompt = [
          "You are an implementation agent in NextGit.",
          `Your implementation strategy is ${body.agentId.includes("alpha") ? "minimal and documentation-first: prefer a concise new file that explains or demonstrates the requested capability without disturbing existing code." : "product-oriented and implementation-first: prefer a useful source or documentation artifact that makes the requested capability concrete for a developer."}`,
          `Agent ID: ${body.agentId}`,
          `Mission: ${body.objective}`,
          "Choose one useful, low-risk repository change that advances the Mission.",
          "For this first general executor, return JSON only with keys path and content.",
          "path must be a relative text-file path without .. and content must be the complete file contents.",
          "Do not overwrite package manifests, lockfiles, Wrangler config, or secrets.",
          "Repository files:",
          listing.stdout ?? "",
        ].join("\n");

        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: env.AGENT_MODEL ?? "gpt-5.2",
            input: prompt,
            max_output_tokens: 1200,
          }),
        });
        const payload = await response.json() as any;
        if (!response.ok) {
          return json({ ok: false, stage: "model", status: response.status, error: payload?.error?.message ?? "Model request failed" }, 500);
        }
        const output = payload.output_text ??
          payload.output?.flatMap((item: any) => item.content ?? [])
            ?.find((part: any) => part.type === "output_text")?.text;
        if (!output) throw new Error("Model returned no text.");

        let plan: { path: string; content: string };
        try {
          plan = JSON.parse(output);
        } catch {
          throw new Error("Model returned invalid JSON.");
        }
        const path = String(plan.path ?? "").replace(/\\/g, "/");
        if (!path || path.startsWith("/") || path.split("/").includes("..") ||
            /^(package(-lock)?\.json|bun\.lock|wrangler\.|\.env)/i.test(path)) {
          throw new Error("Model selected a disallowed path.");
        }

        const encoded = btoa(unescape(encodeURIComponent(String(plan.content ?? ""))));
        await sandbox.setEnvVars({ NEXTGIT_CONTENT_B64: encoded, NEXTGIT_TARGET: path });
        const write = await sandbox.exec([
          `cd ${root}`,
          'mkdir -p "$(dirname "$NEXTGIT_TARGET")"',
          'printf "%s" "$NEXTGIT_CONTENT_B64" | base64 -d > "$NEXTGIT_TARGET"',
          "git add -A",
          "git diff --cached --quiet || git commit -m 'agent: mission attempt'",
          "git push origin HEAD",
          "git rev-parse HEAD",
        ].join(" && "));

        return json({
          ok: write.exitCode === 0,
          runId: body.runId,
          attemptId: body.attemptId,
          agentId: body.agentId,
          repository: body.repositoryName,
          selectedPath: path,
          stdout: write.stdout,
          stderr: write.stderr,
        }, write.exitCode === 0 ? 200 : 500);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Attempt execution failed" }, 500);
      }
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
