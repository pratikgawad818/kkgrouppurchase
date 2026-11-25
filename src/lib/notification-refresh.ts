// A bounded coalescing window: sustained events cannot postpone refresh indefinitely.
export function createNotificationRefresh(refresh: (approvals: boolean) => void, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let approvals = false;
  return {
    schedule(refreshApprovals = false) {
      approvals ||= refreshApprovals;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const pending = approvals;
        approvals = false;
        refresh(pending);
      }, delay);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      approvals = false;
    },
  };
}

export const notificationPollInterval = (connected: boolean) => connected ? 60_000 : 30_000;
