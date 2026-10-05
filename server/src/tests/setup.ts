import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), 'prisma/test.db')}`;
process.env.JWT_SECRET = 'test-secret';
process.env.STORAGE_DIR = path.resolve(process.cwd(), '.tmp/test-storage');
process.env.AI_PROVIDER = 'heuristic';
process.env.LOG_LEVEL = 'silent';
// The suite registers a shop per test from one address; the brute-force
// ceilings are exercised separately in auth.test.ts.
process.env.LOGIN_ATTEMPTS_PER_WINDOW = '100000';
process.env.REGISTRATIONS_PER_HOUR = '100000';
