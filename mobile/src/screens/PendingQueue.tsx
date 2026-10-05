import { TopBar } from '../components/AppShell';
import { Banner, Empty, ErrorNotice, Loading, Screen } from '../components/ui';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { discardOperation, operationLabel, pendingOperations, retryFailed } from '../lib/sync';
import { dateTimeLabel } from '../lib/format';
import { toast } from '../lib/toast';
import { useSession } from '../store/session';

/**
 * Everything the phone is still holding. Nothing here is lost: a rejected
 * entry keeps the reason so the owner can fix the cause and send it again.
 */
export function PendingQueue() {
  const business = useSession((state) => state.business);
  const refreshPending = useSession((state) => state.refreshPending);
  const sync = useSession((state) => state.sync);
  const connection = useSession((state) => state.connection);

  const queue = useAsync(() => pendingOperations(business?.id ?? ''), [business?.id, connection]);

  const send = useSubmit(async () => {
    const summary = await retryFailed(business?.id ?? '');
    await refreshPending();
    queue.reload();
    if (summary.failed) toast.warning(`${summary.failed} could not be saved. Open one to see why.`);
    else if (summary.applied || summary.duplicates) toast.success('Everything is sent.');
    else toast.info('Nothing waiting.');
  });

  const items = queue.data ?? [];

  return (
    <>
      <TopBar title="Waiting to sync" back subtitle={`${items.length} on this phone`} />
      <Screen>
        {connection === 'OFFLINE' ? (
          <Banner tone="warning" icon="📴">
            You are offline. These will be sent automatically when the internet returns.
          </Banner>
        ) : null}

        <ErrorNotice error={queue.error} onRetry={queue.reload} />
        {queue.loading ? <Loading /> : null}

        {!queue.loading && !items.length ? (
          <Empty icon="✅" title="Everything is sent" hint="Bills made offline appear here until they reach the server." />
        ) : null}

        {items.length ? (
          <>
            <button
              type="button"
              className="btn btn-block"
              disabled={send.busy || connection === 'OFFLINE'}
              onClick={() => void send.run()}
            >
              {send.busy ? 'Sending…' : 'Send Now'}
            </button>
            <div className="list">
              {items.map((item) => (
                <div className="list-item" key={item.clientRequestId}>
                  <div className="avatar">{item.status === 'FAILED' ? '⚠️' : '📤'}</div>
                  <div className="li-main">
                    <div className="li-title">
                      {operationLabel[item.type]} · {item.summary}
                    </div>
                    <div className="li-sub">{dateTimeLabel(item.queuedAt)}</div>
                    {item.lastError ? <div className="error-text">{item.lastError}</div> : null}
                  </div>
                  {item.status === 'FAILED' ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={async () => {
                        await discardOperation(item.clientRequestId);
                        await refreshPending();
                        queue.reload();
                        toast.info('Removed from the queue.');
                      }}
                    >
                      Discard
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        <button type="button" className="btn btn-ghost btn-block" onClick={() => void sync({ full: true })}>
          Refresh catalogue from server
        </button>
      </Screen>
    </>
  );
}
