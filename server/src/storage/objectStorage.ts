import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Images live in object storage, never in the relational database. The local
 * driver below is the default for a single-shop deployment; the same interface
 * is what an S3/GCS driver implements for the cloud deployment.
 */
export interface StoredObject {
  ref: string;
  hash: string;
  sizeBytes: number;
}

export interface ObjectStorage {
  put(businessId: string, buffer: Buffer, extension: string): Promise<StoredObject>;
  get(ref: string): Promise<Buffer>;
  delete(ref: string): Promise<void>;
  /** Deletes images older than the retention window (privacy control). */
  purgeOlderThan(businessId: string, cutoff: Date): Promise<number>;
}

class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly baseDir: string) {}

  private resolve(ref: string): string {
    const full = path.resolve(this.baseDir, ref);
    // Refs come from the database, but a traversal bug must never escape the
    // storage root.
    if (!full.startsWith(path.resolve(this.baseDir))) {
      throw new Error('Invalid storage reference');
    }
    return full;
  }

  async put(businessId: string, buffer: Buffer, extension: string): Promise<StoredObject> {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ref = path.join(businessId, `${hash.slice(0, 24)}.${extension.replace(/^\./, '')}`);
    const full = this.resolve(ref);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
    return { ref, hash, sizeBytes: buffer.byteLength };
  }

  async get(ref: string): Promise<Buffer> {
    return fs.readFile(this.resolve(ref));
  }

  async delete(ref: string): Promise<void> {
    await fs.rm(this.resolve(ref), { force: true });
  }

  async purgeOlderThan(businessId: string, cutoff: Date): Promise<number> {
    const dir = this.resolve(businessId);
    let removed = 0;
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        const stat = await fs.stat(path.join(dir, entry));
        if (stat.mtime < cutoff) {
          await fs.rm(path.join(dir, entry), { force: true });
          removed += 1;
        }
      }
    } catch {
      // No directory yet means nothing to purge.
    }
    return removed;
  }
}

export const objectStorage: ObjectStorage = new LocalObjectStorage(config.storageDir);
