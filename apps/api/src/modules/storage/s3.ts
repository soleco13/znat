import type { StorageAdapter } from "./adapter.js";

/**
 * Заглушка на будущее (§10.6 ТЗ): когда /data/assets вырастет за 1 ТБ,
 * переключить StorageAdapter на SeaweedFS/S3 без изменений в бизнес-логике.
 */
export class S3StorageAdapter implements StorageAdapter {
  put(): Promise<{ storageKey: string; sizeBytes: number }> {
    throw new Error("not implemented");
  }

  get(): Promise<NodeJS.ReadableStream> {
    throw new Error("not implemented");
  }

  copy(): Promise<{ storageKey: string; sizeBytes: number }> {
    throw new Error("not implemented");
  }

  remove(): Promise<void> {
    throw new Error("not implemented");
  }
}
