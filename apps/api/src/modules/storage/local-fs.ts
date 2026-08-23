import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { StorageAdapter } from "./adapter.js";

export class LocalFsStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  private resolve(storageKey: string): string {
    const resolved = path.resolve(this.root, storageKey);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error("Invalid storage key: path escapes storage root");
    }
    return resolved;
  }

  async put(input: {
    stream: NodeJS.ReadableStream;
    suggestedName: string;
    schoolId: string;
  }): Promise<{ storageKey: string; sizeBytes: number }> {
    const ext = path.extname(input.suggestedName);
    const storageKey = path.posix.join(input.schoolId, `${randomUUID()}${ext}`);
    const destPath = this.resolve(storageKey);
    await mkdir(path.dirname(destPath), { recursive: true });
    await pipeline(input.stream, createWriteStream(destPath));
    const { size } = await stat(destPath);
    return { storageKey, sizeBytes: size };
  }

  async get(storageKey: string): Promise<NodeJS.ReadableStream> {
    return createReadStream(this.resolve(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }
}
