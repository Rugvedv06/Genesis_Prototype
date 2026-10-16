import { getLocalWorkspaceId } from './workspace.js';

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function metricRow(row) {
  return {
    calls: Number(row.calls ?? 0),
    ok: Number(row.ok ?? 0),
    healed: Number(row.healed ?? 0),
    halted: Number(row.halted ?? 0),
    rejected: Number(row.rejected ?? 0),
    failed: Number(row.failed ?? 0),
    outcomeUncertain: Number(row.outcome_uncertain ?? 0),
    running: Number(row.running ?? 0),
    cacheHits: Number(row.cache_hits ?? 0),
    tokensIn: Number(row.tokens_in ?? 0),
    tokensOut: Number(row.tokens_out ?? 0),
    rounds: Number(row.rounds ?? 0),
    averageRounds: row.average_rounds === null ? null : Number(row.average_rounds ?? 0),
    averageDurationMs: row.average_duration_ms === null ? null : Number(row.average_duration_ms ?? 0),
    tierCounts: {
      T0: Number(row.tier_t0 ?? 0), T1: Number(row.tier_t1 ?? 0), T2: Number(row.tier_t2 ?? 0),
      unknown: Number(row.tier_unknown ?? 0), other: Number(row.tier_other ?? 0),
    },
    p50LatencyMs: row.p50_latency_ms === null ? null : Number(row.p50_latency_ms ?? 0),
    p95LatencyMs: row.p95_latency_ms === null ? null : Number(row.p95_latency_ms ?? 0),
  };
}

export async function snapshotMetrics(queryable) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT count(*) AS calls,
       count(*) FILTER (WHERE outcome IN ('succeeded','healed')) AS ok,
       count(*) FILTER (WHERE outcome = 'healed') AS healed,
       count(*) FILTER (WHERE outcome = 'halted') AS halted,
       count(*) FILTER (WHERE outcome = 'rejected') AS rejected,
       count(*) FILTER (WHERE outcome = 'failed') AS failed,
       count(*) FILTER (WHERE outcome = 'outcome_uncertain') AS outcome_uncertain,
       count(*) FILTER (WHERE outcome = 'running') AS running,
       count(*) FILTER (WHERE cache_hit) AS cache_hits,
       COALESCE(sum(input_tokens), 0) AS tokens_in,
       COALESCE(sum(output_tokens), 0) AS tokens_out,
       COALESCE(sum(rounds), 0) AS rounds,
       avg(rounds) AS average_rounds,
       avg(duration_ms) AS average_duration_ms,
       count(*) FILTER (WHERE tier = 'T0') AS tier_t0,
       count(*) FILTER (WHERE tier = 'T1') AS tier_t1,
       count(*) FILTER (WHERE tier = 'T2') AS tier_t2,
       count(*) FILTER (WHERE tier IS NULL) AS tier_unknown,
       count(*) FILTER (WHERE tier IS NOT NULL AND tier NOT IN ('T0','T1','T2')) AS tier_other,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS p50_latency_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS p95_latency_ms
     FROM invocations WHERE workspace_id = $1`, [workspaceId],
  );
  return { ...metricRow(rows[0]), buckets: [] };
}

export async function metricsTimeseries(queryable, windowSeconds = 300, stepSeconds = 5) {
  const window = boundedInteger(windowSeconds, 300, 1, 2_592_000);
  const step = boundedInteger(stepSeconds, 5, 1, 86_400);
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    `SELECT (floor(extract(epoch FROM started_at) / $3) * $3)::bigint AS t,
       count(*) AS calls,
       count(*) FILTER (WHERE outcome IN ('succeeded','healed')) AS ok,
       count(*) FILTER (WHERE outcome = 'healed') AS healed,
       count(*) FILTER (WHERE outcome = 'halted') AS halted,
       count(*) FILTER (WHERE outcome = 'rejected') AS rejected,
       count(*) FILTER (WHERE outcome = 'failed') AS failed,
       count(*) FILTER (WHERE outcome = 'outcome_uncertain') AS outcome_uncertain,
       count(*) FILTER (WHERE cache_hit) AS cache_hits,
       COALESCE(sum(input_tokens), 0) AS tokens_in,
       COALESCE(sum(output_tokens), 0) AS tokens_out,
       COALESCE(sum(rounds), 0) AS rounds,
       avg(rounds) AS average_rounds,
       avg(duration_ms) AS average_duration_ms,
       count(*) FILTER (WHERE tier = 'T0') AS tier_t0,
       count(*) FILTER (WHERE tier = 'T1') AS tier_t1,
       count(*) FILTER (WHERE tier = 'T2') AS tier_t2,
       count(*) FILTER (WHERE tier IS NULL) AS tier_unknown,
       count(*) FILTER (WHERE tier IS NOT NULL AND tier NOT IN ('T0','T1','T2')) AS tier_other,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS p50_latency_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS p95_latency_ms
     FROM invocations
     WHERE workspace_id = $1
       AND started_at >= now() - ($2::double precision * interval '1 second')
       AND started_at <= now()
     GROUP BY 1 ORDER BY 1`, [workspaceId, window, step],
  );
  return rows.map((row) => ({
    t: Number(row.t), calls: Number(row.calls), ok: Number(row.ok), healed: Number(row.healed),
    halted: Number(row.halted), rejected: Number(row.rejected), cacheHits: Number(row.cache_hits),
    failed: Number(row.failed), outcomeUncertain: Number(row.outcome_uncertain),
    tokensIn: Number(row.tokens_in ?? 0), tokensOut: Number(row.tokens_out ?? 0),
    rounds: Number(row.rounds ?? 0),
    averageRounds: row.average_rounds === null ? null : Number(row.average_rounds ?? 0),
    averageDurationMs: row.average_duration_ms === null ? null : Number(row.average_duration_ms ?? 0),
    tierCounts: {
      T0: Number(row.tier_t0 ?? 0), T1: Number(row.tier_t1 ?? 0), T2: Number(row.tier_t2 ?? 0),
      unknown: Number(row.tier_unknown ?? 0), other: Number(row.tier_other ?? 0),
    },
    p50LatencyMs: row.p50_latency_ms === null ? null : Number(row.p50_latency_ms ?? 0),
    p95LatencyMs: row.p95_latency_ms === null ? null : Number(row.p95_latency_ms ?? 0),
  }));
}
