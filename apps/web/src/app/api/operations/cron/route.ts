import { NextRequest, NextResponse } from 'next/server';
import { OperationsWorker } from '@/features/operations/worker';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Operations cron entrypoint.
 *
 * Fail closed: without a configured shared secret this endpoint refuses to run
 * rather than exposing the job runner. Callers must present the secret in the
 * `x-operations-secret` header. The response is a structured per-job report.
 *
 * Wire this to any authorized scheduler (Vercel cron, Trigger.dev scheduled
 * task, container scheduler) using POST and the secret header. It is safe to
 * call concurrently and repeatedly: every job is state-guarded and idempotent.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.OPERATIONS_CRON_SECRET;

  if (!secret || secret.trim().length < 16) {
    return NextResponse.json(
      {
        error: 'Operations runner is not configured (fail-closed invariant).',
        code: 'OPERATIONS_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const presented = req.headers.get('x-operations-secret') ?? '';
  if (presented !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const worker = new OperationsWorker(getSupabaseAdmin());
    const report = await worker.runCycle();

    // Allowlisted structured log: job names, counts and durations only.
    console.log(
      JSON.stringify({
        event: 'operations_cycle',
        started_at: report.startedAt,
        finished_at: report.finishedAt,
        jobs: report.jobs.map((j) => ({
          job: j.job,
          changed: j.changed,
          errors: j.errors.length,
          duration_ms: j.durationMs,
        })),
      })
    );

    const failed = report.jobs.filter((j) => j.errors.length > 0);
    return NextResponse.json(report, { status: failed.length > 0 ? 207 : 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Operations cycle failed', code: 'OPERATIONS_CYCLE_FAILED' },
      { status: 500 }
    );
  }
}
