export type DeploymentProviderId = "cloudflare" | "vercel" | "railway";

export interface DeploymentRequest {
  projectId: string;
  repositoryName: string;
  deploymentName: string;
}

export interface DeploymentResult {
  ok: boolean;
  provider: DeploymentProviderId;
  status: "ready" | "failed";
  url?: string;
  deploymentId?: string;
  error?: string;
}

export interface DeploymentProvider {
  id: DeploymentProviderId;
  deploy(request: DeploymentRequest): Promise<DeploymentResult>;
}

export class CloudflareDeploymentProvider implements DeploymentProvider {
  readonly id = "cloudflare" as const;
  constructor(private readonly executor: Fetcher) {}

  async deploy(request: DeploymentRequest): Promise<DeploymentResult> {
    const response = await this.executor.fetch("https://executor/deploy-cloudflare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await response.json() as any;
    return { provider: this.id, status: response.ok && result?.ok ? "ready" : "failed", ...result, ok: response.ok && result?.ok === true };
  }
}
