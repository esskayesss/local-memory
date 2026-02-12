export type MemoryKind =
  | "summary"
  | "preference"
  | "constraint"
  | "decision"
  | "fact"
  | "note";

export interface BagPolicy {
  name: string;
  description: string | null;
  defaultTopK: number;
  recencyHalfLifeDays: number;
  importanceWeight: number;
  allowedKinds: MemoryKind[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  bag: string;
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: number;
  source: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  expiresAt: string | null;
}

export interface StoreMemoryInput {
  bag: string;
  kind: MemoryKind;
  content: string;
  tags?: string[];
  importance?: number;
  source?: Record<string, unknown>;
  expiresAt?: string | null;
}

export interface RecallMemoryInput {
  query: string;
  bag?: string;
  kinds?: MemoryKind[];
  tags?: string[];
  topK?: number;
  candidateLimit?: number;
}

export interface RecallResult {
  memory: MemoryRecord;
  score: number;
  scoreBreakdown: {
    similarity: number;
    recencyBoost: number;
    importanceBoost: number;
    tagBoost: number;
  };
}
