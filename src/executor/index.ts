import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "nextgit-executor",
        runtime: "sandbox-stable",
      });
    }

    if (url.pathname === "/sandbox-proof") {
      try {
        const sandbox = getSandbox(env.Sandbox, "bootstrap-proof");
        const result = await sandbox.exec(
          "git --version && node --version && pwd",
        );

        return json({
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }, result.exitCode === 0 ? 200 : 500);
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : "Sandbox proof failed",
        }, 500);
      }
    }

    return json({
      service: "nextgit-executor",
      endpoints: ["GET /health", "GET /sandbox-proof"],
    });
  },
};
