import 'dotenv/config';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL ?? 60 * 60 * 12),
  refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL ?? 60 * 60 * 24 * 30),
  storageDir: path.resolve(rootDir, process.env.STORAGE_DIR ?? './storage'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024),
  /// heuristic | openai. The AI key never leaves the server.
  aiProvider: process.env.AI_PROVIDER ?? 'heuristic',
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  /// Brute-force protection on the PIN screen. A shop with many counters
  /// behind one connection needs a higher ceiling than the default.
  loginAttemptsPerWindow: Number(process.env.LOGIN_ATTEMPTS_PER_WINDOW ?? 20),
  registrationsPerHour: Number(process.env.REGISTRATIONS_PER_HOUR ?? 10),
};

export const isProduction = config.env === 'production';
