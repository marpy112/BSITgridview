export function isDailyDatabaseLimit(error) {
  return error?.code === 'DATABASE_DAILY_LIMIT' ||
    /exceeded.{0,120}(?:daily|free tier).{0,80}(?:row|read|writ|quer).{0,80}limit/i.test(error?.message || '');
}

export function dailyDatabaseLimit(now = Date.now()) {
  const date = new Date(now);
  const reset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Object.assign(new Error("Today's free database allowance has been reached. Please try again after the daily reset."), {
    status: 503, code: 'DATABASE_DAILY_LIMIT', retryAt: new Date(reset).toISOString(),
    retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)),
  });
}
