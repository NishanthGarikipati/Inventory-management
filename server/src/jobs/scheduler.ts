import { prisma } from '../db/prisma.js';
import { refreshBusinessAlerts } from '../services/notification.service.js';
import { logger } from '../utils/logger.js';

const ALERT_INTERVAL_MS = 30 * 60_000;

/**
 * Background work that must not sit in a request: expiry/dues sweeps and
 * cleaning up replay keys. Deliberately simple (an interval, not a queue) so a
 * single-shop deployment needs no extra infrastructure; the same functions can
 * be triggered by a real job runner in a multi-store deployment.
 */
export function startBackgroundJobs(): () => void {
  const alerts = setInterval(() => {
    void runAlertSweep();
  }, ALERT_INTERVAL_MS);

  const cleanup = setInterval(
    () => {
      void prisma.idempotencyKey
        .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400_000) } } })
        .catch(() => undefined);
    },
    6 * 3600_000,
  );

  alerts.unref?.();
  cleanup.unref?.();

  return () => {
    clearInterval(alerts);
    clearInterval(cleanup);
  };
}

export async function runAlertSweep(): Promise<void> {
  try {
    const businesses = await prisma.business.findMany({ where: { isActive: true }, select: { id: true } });
    for (const business of businesses) {
      await refreshBusinessAlerts(business.id);
    }
  } catch (error) {
    logger.error({ err: error }, 'alert sweep failed');
  }
}
