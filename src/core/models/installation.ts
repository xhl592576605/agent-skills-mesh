export type InstallationStatus =
  | "installed"
  | "available"
  | "unsupported"
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
  installedCandidateId?: string;
  reason?: string;
}
