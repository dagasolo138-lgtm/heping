import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { createLongRunAuditWorld } from './longRunAuditWorld.js';

const TARGET_DAY = Math.max(2, Math.floor(Number(process.env.AUDIT_TARGET_DAY ?? 60)));
const BATCH_SIZE = Math.max(1, Math.floor(Number(process.env.AUDIT_BATCH_SIZE ?? 10)));
const CHECKPOINT_STEP_DAYS = Math.max(5, Math.floor(Number(process.env.AUDIT_CHECKPOINT_DAYS ?? 15)));
const TARGET_MINUTE = 720;
const START_MINUTE = 480;
const ARTIFACT_DIR = '.artifacts';
const SEED = process.env.AUDIT_SEED ?? 'replay-seed-v0277-stability';
const MAX_HEAP_BYTES = 1_250 * 1024 * 1024;
const MIN_TICKS_PER_SECOND = 20;

function targetTick(day, minute = TARGET_MINUTE) {
  return (day - 1) * 1440 + (minute - START_MINUTE);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function reportIdentity(report) {
  return `${report.year}:${report.day}`;
}

function finalizedReportDigest(report) {
  return digest({
    year: report.year,
    day: report.day,
    openingInventory: report.openingInventory,
    closingInventory: report.closingInventory,
    flow: report.flow,
    balances: report.balances,
    labor: report.labor,
    denials: report.denials,
    stockTargets: report.stockTargets,
    stockGaps: report.stockGaps,
    stockGapRatios: report.stockGapRatios,
    spoilagePressure: report.spoilagePressure,
    bottlenecks: report.bottlenecks,
    simulationErrors: report.simulationErrors,
    ok: report.ok,
  });
}

function compactIssues(result) {
  return (result?.issues ?? []).slice(0, 12);
}

function auditCheckpoint(world, expectedDay, historicalDigests) {
  const now = world.time.now();
  const actionDiagnostics = world.actions.getDiagnostics();
  const lifecycleVerification = world.taskLifecycle.verify();
  const flowVerification = world.resourceFlow.verify();
  const economyVerification = world.dailyEconomy.verify();
  const activeTasks = world.taskLifecycle.list({ status: 'active' });
  const activeTaskIds = new Set(activeTasks.map((record) => record.taskId));
  const reservations = world.reservationLedger.list();
  const toolAssignments = world.tools.getAssignments();
  const alive = world.people.getAliveRuntime().length;
  const reports = world.dailyEconomy.listReports();
  const currentKey = `${now.year}:${now.day}`;
  const finalizedReports = reports.filter((report) => reportIdentity(report) !== currentKey);
  const lifecycleState = world.taskLifecycle.exportState();
  const flowEntries = world.resourceFlow.list();
  const orphanReservations = reservations.filter((entry) => entry.taskId && !activeTaskIds.has(entry.taskId));
  const orphanTools = toolAssignments.filter((entry) => !activeTaskIds.has(entry.taskId));
  const duplicateReservationIds = reservations
    .map((entry) => entry.id)
    .filter((id, index, all) => all.indexOf(id) !== index);

  assert.deepEqual(
    { year: now.year, day: now.day, minute: now.minute, tick: now.tick },
    { year: 1, day: expectedDay, minute: TARGET_MINUTE, tick: targetTick(expectedDay) },
  );
  assert.equal(actionDiagnostics.lastSimulationError, null, JSON.stringify(actionDiagnostics.lastSimulationError));
  assert.equal(lifecycleVerification.ok, true, JSON.stringify(compactIssues(lifecycleVerification)));
  assert.equal(flowVerification.ok, true, JSON.stringify(compactIssues(flowVerification)));
  assert.equal(economyVerification.ok, true, JSON.stringify(compactIssues(economyVerification)));
  assert.equal(reports.length, expectedDay, `Expected ${expectedDay} reports, got ${reports.length}`);
  assert.ok(activeTasks.length <= alive, `Active tasks ${activeTasks.length} exceed alive people ${alive}`);
  assert.ok(reservations.length <= alive * 5, `Reservation count ${reservations.length} exceeds bound ${alive * 5}`);
  assert.deepEqual(orphanReservations, [], `Orphan reservations: ${JSON.stringify(orphanReservations)}`);
  assert.deepEqual(orphanTools, [], `Orphan tool assignments: ${JSON.stringify(orphanTools)}`);
  assert.deepEqual(duplicateReservationIds, [], `Duplicate reservation IDs: ${JSON.stringify(duplicateReservationIds)}`);
  assert.ok(flowEntries.length <= 5000, `Resource flow exceeded cap: ${flowEntries.length}`);
  assert.ok((lifecycleState.records ?? []).length <= 5000, `Lifecycle records exceeded cap: ${lifecycleState.records?.length}`);
  assert.ok((lifecycleState.stageCosts ?? []).length <= 5000, `Stage costs exceeded cap: ${lifecycleState.stageCosts?.length}`);

  finalizedReports.forEach((report) => {
    const key = reportIdentity(report);
    const nextDigest = finalizedReportDigest(report);
    if (historicalDigests.has(key)) {
      assert.equal(
        nextDigest,
        historicalDigests.get(key),
        `Finalized economic report mutated after day rollover: ${key}`,
      );
    } else {
      historicalDigests.set(key, nextDigest);
    }
  });

  return {
    time: now,
    alive,
    activeTasks: activeTasks.length,
    closedTasks: lifecycleVerification.totalClosed,
    stageTransitions: lifecycleVerification.stageTransitions,
    reservations: world.reservationLedger.getSummary(),
    toolSummary: world.tools.getSummary(),
    flowEntries: flowEntries.length,
    reports: reports.length,
    finalizedReports: finalizedReports.length,
    heapUsedBytes: process.memoryUsage().heapUsed,
    validations: {
      lifecycle: lifecycleVerification.ok,
      resourceFlow: flowVerification.ok,
      dailyEconomy: economyVerification.ok,
      simulationError: actionDiagnostics.lastSimulationError,
      orphanReservations: orphanReservations.length,
      orphanTools: orphanTools.length,
    },
  };
}

function checkpointDays(targetDay) {
  const values = [];
  for (let day = CHECKPOINT_STEP_DAYS; day < targetDay; day += CHECKPOINT_STEP_DAYS) values.push(day);
  values.push(targetDay);
  return [...new Set(values)].sort((first, second) => first - second);
}

function advanceInBatches(world, ticks) {
  let remaining = ticks;
  while (remaining > 0) {
    const amount = Math.min(BATCH_SIZE, remaining);
    world.actions.advanceTicks(amount);
    remaining -= amount;
  }
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const artifactName = `stability-day${TARGET_DAY}-batch${BATCH_SIZE}.json`;
const artifactPath = `${ARTIFACT_DIR}/${artifactName}`;
const world = createLongRunAuditWorld(SEED);
const historicalDigests = new Map();
const checkpoints = [];
const startedAt = performance.now();
let previousTick = world.time.now().tick;
let failure = null;

try {
  for (const day of checkpointDays(TARGET_DAY)) {
    const expectedTick = targetTick(day);
    const delta = expectedTick - previousTick;
    const segmentStartedAt = performance.now();
    advanceInBatches(world, delta);
    const segmentElapsedMs = performance.now() - segmentStartedAt;
    const snapshot = auditCheckpoint(world, day, historicalDigests);
    snapshot.segment = {
      ticks: delta,
      elapsedMs: Math.round(segmentElapsedMs),
      ticksPerSecond: Math.round(delta / Math.max(0.001, segmentElapsedMs / 1000)),
    };
    assert.ok(snapshot.heapUsedBytes < MAX_HEAP_BYTES, `Heap usage exceeded limit: ${snapshot.heapUsedBytes}`);
    assert.ok(
      snapshot.segment.ticksPerSecond >= MIN_TICKS_PER_SECOND,
      `Long-run throughput fell below ${MIN_TICKS_PER_SECOND} ticks/s: ${snapshot.segment.ticksPerSecond}`,
    );
    checkpoints.push(snapshot);
    previousTick = expectedTick;
    console.log(
      `STABILITY_CHECKPOINT day=${day} batch=${BATCH_SIZE} `
      + `ticksPerSecond=${snapshot.segment.ticksPerSecond} heap=${snapshot.heapUsedBytes} `
      + `active=${snapshot.activeTasks} reservations=${snapshot.reservations.total}`,
    );
  }

  const elapsedMs = performance.now() - startedAt;
  const report = {
    status: 'pass',
    seed: SEED,
    targetDay: TARGET_DAY,
    targetMinute: TARGET_MINUTE,
    batchSize: BATCH_SIZE,
    totalTicks: targetTick(TARGET_DAY),
    elapsedMs: Math.round(elapsedMs),
    ticksPerSecond: Math.round(targetTick(TARGET_DAY) / Math.max(0.001, elapsedMs / 1000)),
    historicalReportsTracked: historicalDigests.size,
    checkpoints,
  };
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`STABILITY_AUDIT=PASS day=${TARGET_DAY} batch=${BATCH_SIZE}`);
  console.log(`STABILITY_AUDIT_ARTIFACT=${artifactPath}`);
} catch (error) {
  failure = {
    status: 'fail',
    seed: SEED,
    targetDay: TARGET_DAY,
    batchSize: BATCH_SIZE,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    currentTime: world.time.now(),
    checkpoints,
  };
  await writeFile(artifactPath, `${JSON.stringify(failure, null, 2)}\n`);
  throw error;
} finally {
  world.restoreGlobals();
}
