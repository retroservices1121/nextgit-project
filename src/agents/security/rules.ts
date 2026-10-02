import type { SecurityObservation } from "../../security/policy";

export interface ChangedFile {
  path: string;
  content: string;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "Generic bearer token", pattern: /authorization\s*[:=]\s*["'`]bearer\s+[A-Za-z0-9._-]{20,}/i },
];

export function deterministicSecurityScan(
  files: ChangedFile[],
): SecurityObservation[] {
  const observations: SecurityObservation[] = [];

  for (const file of files) {
    for (const secret of SECRET_PATTERNS) {
      if (secret.pattern.test(file.content)) {
        observations.push({
          title: `Potential exposed secret: ${secret.name}`,
          description: "A credential-like value was introduced into source-controlled content.",
          severity: "critical",
          file: file.path,
          remediation: "Remove the credential from source, rotate it, and load it from a secret binding.",
        });
      }
    }

    if (/eval\s*\(/.test(file.content)) {
      observations.push({
        title: "Dynamic code execution detected",
        description: "The change introduces eval(), which can create code-injection risk when input is not strictly controlled.",
        severity: "high",
        file: file.path,
        remediation: "Replace eval() with explicit parsing or a constrained implementation.",
      });
    }
  }

  return observations;
}
