import type { LocalCardOcrResult } from "@/lib/ocr/localCardOcr";
import type {
  RapidScanSession,
  ResolveResult,
} from "@/lib/rapidScan/contracts";

export type ResolveRequest = {
  session: RapidScanSession;
  ocr: LocalCardOcrResult;
};

export interface CardResolver {
  readonly game: RapidScanSession["game"];
  listSets(): Promise<Array<{ id: string; name: string }>>;
  resolve(request: ResolveRequest): Promise<ResolveResult>;
}
