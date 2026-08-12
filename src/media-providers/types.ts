export type MediaKind = "image" | "video";
export type ProviderTier = "free" | "open" | "paid" | "enterprise" | "generated";

export interface LicenseEvidence {
  name: string;
  url: string;
  commercialUse: boolean;
  attributionRequired: boolean;
  snapshotText: string;
  capturedAt: string;
}

export interface MediaCandidate {
  id: string;
  provider: string;
  tier: ProviderTier;
  kind: MediaKind;
  previewUrl: string;
  sourceUrl: string;
  downloadUrl: string;
  author: string;
  width: number;
  height: number;
  durationSeconds?: number;
  watermarked: boolean;
  motionScore: number;
  semanticScore: number;
  compositionScore: number;
  styleScore: number;
  perceptualHash?: string;
  license?: LicenseEvidence;
}

export interface SearchRequest {
  query: string;
  kind: MediaKind;
  limit: number;
  orientation: "portrait" | "landscape" | "square";
}

export interface MediaProvider {
  readonly id: string;
  readonly tier: ProviderTier;
  isAvailable(): Promise<boolean>;
  search(request: SearchRequest, signal?: AbortSignal): Promise<MediaCandidate[]>;
}
