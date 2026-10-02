import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { CodingHarness } from "../../runtime/attempt-execution";
import type { AgentSandboxStub } from "../../runtime/agent-runtime";

function assertRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Path must stay inside the Attempt workspace.");
  }
  return normalized;
}

function makeTools(sandbox: AgentSandboxStub) {
  const readFile = createTool({
    id: "read-file",
    description: "Read a UTF-8 text file from the Attempt repository.",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const relative = assertRelativePath(path);
      const result = await sandbox.run(
        [
          "sh",
          "-lc",
          'cd /workspace/project && cat -- "$TARGET"',
        ],
        { TARGET: relative },
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || "Unable to read file.");
      }
      return { path: relative, content: result.stdout };
    },
  });

  const listFiles = createTool({
    id: "list-files",
    description: "List repository files. Use a path or '.' for the root.",
    inputSchema: z.object({ path: z.string().default(".") }),
    execute: async ({ path }) => {
      const relative = path === "." ? "." : assertRelativePath(path);
      const result = await sandbox.run(
        [
          "sh",
          "-lc",
          'cd /workspace/project && find "$TARGET" -maxdepth 3 -type f -not -path "./.git/*" | sort | head -500',
        ],
        { TARGET: relative },
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Unable to list files.");
      }
      return { files: result.stdout.split("\n").filter(Boolean) };
    },
  });

  const writeFile = createTool({
    id: "write-file",
    description:
      "Create or replace a UTF-8 text file inside the Attempt repository.",
    inputSchema: z.object({
      path: z.string(),
      content: z.string(),
    }),
    execute: async ({ path, content }) => {
      const relative = assertRelativePath(path);
      const encoded = btoa(unescape(encodeURIComponent(content)));
      const result = await sandbox.run(
        [
          "sh",
          "-lc",
          [
            "set -eu",
            'cd /workspace/project',
            'mkdir -p "$(dirname "$TARGET")"',
            'printf "%s" "$CONTENT_B64" | base64 -d > "$TARGET"',
          ].join("\n"),
        ],
        { TARGET: relative, CONTENT_B64: encoded },
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Unable to write file.");
      }
      return { path: relative, bytes: content.length };
    },
  });

  const runCommand = createTool({
    id: "run-command",
    description:
      "Run a shell command inside the isolated Attempt repository. Use this for tests, installs, formatting, and repository inspection.",
    inputSchema: z.object({
      command: z.string().min(1),
    }),
    execute: async ({ command }) => {
      const result = await sandbox.run(
        ["sh", "-lc", 'cd /workspace/project && eval "$AGENT_COMMAND"'],
        { AGENT_COMMAND: command },
      );
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 20000),
        stderr: result.stderr.slice(0, 20000),
      };
    },
  });

  return { readFile, listFiles, writeFile, runCommand };
}

export class MastraSandboxHarness implements CodingHarness {
  readonly id: string;

  constructor(
    id: string,
    private readonly model: string,
  ) {
    this.id = id;
  }

  async run(input: {
    sandbox: AgentSandboxStub;
    workspace: string;
    objective: string;
  }) {
    const tools = makeTools(input.sandbox);

    const agent = new Agent({
      id: this.id,
      name: this.id,
      model: this.model,
      instructions: [
        "You are an implementation agent working inside an isolated software Attempt.",
        "Complete the user's Mission by inspecting and modifying the repository.",
        "Use the provided filesystem and command tools.",
        "Do not alter Git remotes, credentials, or repository authentication.",
        "Run relevant tests or checks before finishing.",
        "Do not merely describe changes: make them in the workspace.",
      ].join("\n"),
      tools,
    });

    await agent.generate(input.objective);

    const diff = await input.sandbox.run([
      "sh",
      "-lc",
      "cd /workspace/project && git diff --name-only && git ls-files --others --exclude-standard",
    ]);

    if (diff.exitCode !== 0) {
      throw new Error(diff.stderr || "Unable to inspect agent changes.");
    }

    const filesChanged = Array.from(
      new Set(diff.stdout.split("\n").map((x) => x.trim()).filter(Boolean)),
    );

    return {
      summary:
        filesChanged.length > 0
          ? `${this.id} changed ${filesChanged.length} file(s).`
          : `${this.id} completed without file changes.`,
      filesChanged,
    };
  }
}
