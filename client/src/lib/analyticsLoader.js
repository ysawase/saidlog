const IMPORT_TIMEOUT_MS = 300;

let analyticsModule = null;
let analyticsImportPromise = null;
let analyticsImportFailed = false;

function loadAnalytics() {
  if (analyticsModule) return Promise.resolve(analyticsModule);
  if (analyticsImportFailed) return Promise.resolve(null);

  if (!analyticsImportPromise) {
    analyticsImportPromise = import('./analytics.js')
      .then((module) => {
        analyticsModule = module;
        return module;
      })
      .catch(() => {
        analyticsImportFailed = true;
        return null;
      });
  }

  return analyticsImportPromise;
}

async function loadAnalyticsWithTimeout() {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), IMPORT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([loadAnalytics(), timeoutPromise]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function trackEventSafe(eventName, options) {
  try {
    void loadAnalytics()
      .then((module) => module?.trackEvent(eventName, options))
      .catch(() => {});
  } catch {
    // analyticsは補助機能のため、読み込み・送信失敗を無視する。
  }
}

export async function getSessionIdSafe() {
  try {
    const module = await loadAnalyticsWithTimeout();
    if (!module) return null;
    return module.getOrCreateSessionId();
  } catch {
    return null;
  }
}
