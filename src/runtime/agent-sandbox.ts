import { DurableObject } from "cloudflare:workers";

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

export class AgentSandbox extends DurableObject {
  private readonly container: any;

  constructor(ctx: DurableObjectState, env: unknown) {
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

  async destroy() {
    if (this.container.running) {
      await this.container.destroy();
    }
  }
}
