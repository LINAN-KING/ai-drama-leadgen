export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}
export interface AlignedWord extends TranscriptWord {
  sourceText: string;
  sourceIndex: number;
  matched: boolean;
}
export interface AlignmentReport {
  words: AlignedWord[];
  coverage: number;
  medianErrorMs: number;
  substitutionRate: number;
  passed: boolean;
  failures: string[];
}
