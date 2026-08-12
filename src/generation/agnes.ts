import type { LicenseEvidence, MediaCandidate } from "../media-providers/types.js";

export interface AgnesRequest {
  prompt: string;
  kind: "image" | "video";
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSeconds?: number;
  seed: number;
}

export interface AgnesArtifact {
  id: string;
  localPath: string;
  width: number;
  height: number;
  durationSeconds?: number;
  model: string;
}

export interface AgnesClient {
  isAvailable(): Promise<boolean>;
  generate(request: AgnesRequest, signal?: AbortSignal): Promise<AgnesArtifact>;
}

export function agnesCandidate(artifact: AgnesArtifact, request: AgnesRequest): MediaCandidate {
  const license: LicenseEvidence = {
    name: "User-authorized Agnes generation",
    url: "local://agnes-generation",
    commercialUse: true,
    attributionRequired: false,
    snapshotText: `Generated for this task with ${artifact.model}; usage authority confirmed by the user configuration.`,
    capturedAt: new Date().toISOString(),
  };
  return {
    id: `agnes-${artifact.id}`,
    provider: "agnes",
    tier: "generated",
    kind: request.kind,
    previewUrl: artifact.localPath,
    sourceUrl: `local://agnes/${artifact.id}`,
    downloadUrl: artifact.localPath,
    author: artifact.model,
    width: artifact.width,
    height: artifact.height,
    durationSeconds: artifact.durationSeconds,
    watermarked: false,
    motionScore: request.kind === "video" ? 0.7 : 0,
    semanticScore: 0.8,
    compositionScore: 0.7,
    styleScore: 0.75,
    license,
  };
}
