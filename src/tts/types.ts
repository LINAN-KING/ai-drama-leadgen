export type TtsProviderId = "edge" | "mimo";

export interface TtsSegment {
  id: string;
  text: string;
  index: number;
}
export interface TtsSynthesisRequest {
  segment: TtsSegment;
  outputPath: string;
  voiceStyle: string;
  speed: number;
}
export interface TtsProvider {
  readonly id: TtsProviderId;
  isAvailable(): Promise<boolean>;
  synthesize(request: TtsSynthesisRequest): Promise<void>;
}
