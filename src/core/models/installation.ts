export type InstallationStatus =
  | "installed"
  | "conflict"
  | "broken-link"
  | "external"
  | "missing";

export interface InstallationRecord {
  id: string;
  skillName: string;
  agentId: string;
  status: InstallationStatus;
  targetPath: string;
  linkTarget?: string;
  expectedLinkTarget?: string;
  reason?: string;
}
