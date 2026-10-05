import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DB = path.resolve(process.cwd(), 'prisma/test.db');

export default function setup() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `file:${TEST_DB}`;
  process.env.JWT_SECRET = 'test-secret';
  process.env.STORAGE_DIR = path.resolve(process.cwd(), '.tmp/test-storage');

  fs.rmSync(TEST_DB, { force: true });
  fs.rmSync(`${TEST_DB}-journal`, { force: true });
  fs.rmSync(path.resolve(process.cwd(), '.tmp/test-storage'), { recursive: true, force: true });

  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
  });
}
