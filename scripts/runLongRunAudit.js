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

function finalWorldStateDigest(world) {
  return digest({
    time: world.time.now(),
    people: world.people.list({ sortBy: 'birth' }),
    camp: world.camp.exportState(),
    buildings: world.buildings.exportState(),
    fire: world.fire.exportState(),
    farms: world.farms.exportState(),
    farmSeeds: world.farms.getSeedSummary(),
    ecology: world.ecology.exportState(),
    roads: world.roads.exportState(),
    foodStorage: world.foodStorage.exportState(),
    tools: world.tools.exportState(),
    toolCoverage: world.tools.getCoverage(),
    maintenanceRuntime: world.toolMaintenanceRuntime.listReservations(),
    socialEvents: world.socialEvents.exportState(),
    chronicles: world.chronicles.exportState(),
    reservations: world.reservationLedger.list(),
    resourceFlowTaskContexts: world.resourceFlowTaskContextGuard.getSummary(),
    taskLifecycle: world.taskLifecycle.exportState(),
    resourceFlow: world.resourceFlow.exportState(),
    dailyEconomy: world.dailyEconomy.exportState(),
    worldDynamics: world.worldDynamics.exportState(),
  });
}

function compactIssues(result) {
  return (result?.issues ?? result?.errors ?? []).slice(0, 12);
}

function auditCheckpoint(world, expectedDay, historicalDigests) {
  const now = world.time.now();
  const actionDiagnostics = world.actions.getDiagnostics();
  const lifecycleVerification = world.taskLifecycle.verify();
  const flowVerification = world.resourceFlow.verify();
  const taskContextVerification = world.resourceFlowTaskContextGuard.verify();
  const economyVerification = world.dailyEconomy.verify();
  const dynamicsVerification = world.worldDynamics.verify();
  const dynamicsSummary = world.worldDynamics.getSummary();
  const maintenanceVerification = world.tools.verifyMaintenance();
  const maintenanceRuntimeVerification = world.toolMaintenanceRuntime.verify();
  const seedVerification = world.farms.verifySeeds();
  const seedSummary = world.farms.getSeedSummary();
  const farmFields = world.farms.listFields();
  const productiveFields = farmFields.filter((field) => field.status === 'growing' || field.status === 'mature').length;
  const activeTasks = world.taskLifecycle.list({ status: 'active' });
  const activeTaskIds = new Set(activeTasks.map((record) => record.taskId));
  const reservations = world.reservationLedger.list();
  const toolAssignments = world.tools.getAssignments();
  const tools = world.tools.list();
  const toolCoverage = world.tools.getCoverage();
  const maintenanceDemands = world.tools.listMaintenanceDemands();
  const maintenanceReservations = world.toolMaintenanceRuntime.listReservations();
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
  assert.equal(taskContextVerification.ok, true, JSON.stringify(compactIssues(taskContextVerification)));
  assert.equal(economyVerification.ok, true, JSON.stringify(compactIssues(economyVerification)));
  assert.equal(dynamicsVerification.ok, true, JSON.stringify(compactIssues(dynamicsVerification)));
  assert.equal(maintenanceVerification.ok, true, JSON.stringify(compactIssues(maintenanceVerification)));
  assert.equal(maintenanceRuntimeVerification.ok, true, JSON.stringify(compactIssues(maintenanceRuntimeVerification)));
  assert.equal(seedVerification.ok, true, JSON.stringify(compactIssues(seedVerification)));
  assert.equal(maintenanceVerification.demandCount, maintenanceDemands.length);
  assert.equal(maintenanceVerification.replacementDemandCount, maintenanceDemands.filter((demand) => demand.mode === 'replace').length);
  assert.equal(maintenanceVerification.guaranteeGapCount, toolCoverage.filter((entry) => entry.gap > 0).length);
  assert.ok(maintenanceDemands.length <= tools.length, 'Maintenance demands exceed tool count');
  assert.ok(maintenanceReservations.length <= 1, 'More than one maintenance or replacement task is active');
  assert.ok(maintenanceRuntimeVerification.repairActive + maintenanceRuntimeVerification.replacementActive <= 1);
  assert.equal(reports.length, expectedDay, `Expected ${expectedDay} reports, got ${reports.length}`);
  assert.ok(activeTasks.length <= alive, `Active tasks ${activeTasks.length} exceed alive people ${alive}`);
  assert.ok(taskContextVerification.tracked <= alive, `Task contexts ${taskContextVerification.tracked} exceed alive people ${alive}`);
  assert.ok(reservations.length <= alive * 6, `Reservation count ${reservations.length} exceeds bound ${alive * 6}`);
  assert.deepEqual(orphanReservations, [], `Orphan reservations: ${JSON.stringify(orphanReservations)}`);
  assert.deepEqual(orphanTools, [], `Orphan tool assignments: ${JSON.stringify(orphanTools)}`);
  assert.deepEqual(duplicateReservationIds, [], `Duplicate reservation IDs: ${JSON.stringify(duplicateReservationIds)}`);
  assert.ok(flowEntries.length <= 5000, `Resource flow exceeded cap: ${flowEntries.length}`);
  assert.ok((lifecycleState.records ?? []).length <= 5000, `Lifecycle records exceeded cap: ${lifecycleState.records?.length}`);
  assert.ok((lifecycleState.stageCosts ?? []).length <= 5000, `Stage costs exceeded cap: ${lifecycleState.stageCosts?.length}`);
  assert.ok(dynamicsSummary.activePressures <= 16, `Too many active world pressures: ${dynamicsSummary.activePressures}`);
  assert.ok(dynamicsSummary.activeOpportunities <= 16, `Too many active world opportunities: ${dynamicsSummary.activeOpportunities}`);
  assert.ok(seedSummary.onHand >= 0, 'Seed stock became negative');
  assert.ok(seedSummary.inTransit <= seedSummary.carried + 0.001, 'In-transit seeds exceed carried seeds');
  if (farmFields.length > 0) assert.ok(seedSummary.onHand + productiveFields > 0, 'Agriculture lost all seed stock and productive crops');

  tools.forEach((tool) => {
    assert.ok(Number(tool.generation) >= 1, `Invalid tool generation: ${tool.id}`);
    assert.ok(Number(tool.repairsSinceReplacement) >= 0, `Negative generation repair count: ${tool.id}`);
    assert.ok(Number(tool.wearSinceReplacement) >= 0, `Negative generation wear: ${tool.id}`);
    assert.ok(Number(tool.wearSinceReplacement) <= Number(tool.totalWear) + 0.001, `Generation wear exceeds total wear: ${tool.id}`);
  });
  toolCoverage.forEach((coverage) => {
    assert.equal(coverage.protected, true, `Unprotected public tool guarantee: ${coverage.typeId}`);
    if (coverage.gap > 0) {
      assert.ok(
        maintenanceDemands.some((demand) => demand.typeId === coverage.typeId && demand.guaranteeGap),
        `Guarantee gap lacks recovery demand: ${coverage.typeId}`,
      );
    }
  });
  maintenanceReservations.forEach((reservation) => {
    assert.ok(['repair', 'replace'].includes(reservation.mode), `Invalid maintenance mode: ${reservation.taskId}`);
    assert.ok(['repairTool', 'replaceTool'].includes(reservation.actionType), `Invalid maintenance action: ${reservation.taskId}`);
  });

  finalizedReports.forEach((report) => {
    const key = reportIdentity(report);
    const nextDigest = finalizedReportDigest(report);
    if (historicalDigests.has(key)) {
      assert.equal(nextDigest, historicalDigests.get(key), `Finalized economic report mutated after day rollover: ${key}`);
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
    resourceFlowTaskContexts: {
      tracked: taskContextVerification.tracked,
      clearedTerminal: taskContextVerification.clearedTerminal,
      clearedOnLoad: taskContextVerification.clearedOnLoad,
    },
    reservations: world.reservationLedger.getSummary(),
    toolSummary: world.tools.getSummary(),
    toolCoverage,
    maintenance: {
      demands: maintenanceDemands.length,
      urgent: maintenanceDemands.filter((demand) => demand.priority === 'high').length,
      replacements: maintenanceDemands.filter((demand) => demand.mode === 'replace').length,
      generations: Object.fromEntries(tools.map((tool) => [tool.id, tool.generation])),
      guaranteeGaps: toolCoverage.filter((entry) => entry.gap > 0).length,
      activeTasks: maintenanceReservations.length,
      activeRepairs: maintenanceRuntimeVerification.repairActive,
      activeReplacements: maintenanceRuntimeVerification.replacementActive,
      failedReservations: maintenanceRuntimeVerification.failedReservations,
      verification: maintenanceVerification.ok && maintenanceRuntimeVerification.ok,
    },
    farming: {
      fields: farmFields.length,
      productiveFields,
      matureFields: farmFields.filter((field) => field.status === 'mature').length,
      seed: seedSummary,
      seedReservations: seedVerification.reservations,
      verification: seedVerification.ok,
    },
    worldDynamics: {
      summary: dynamicsSummary,
      pressures: world.worldDynamics.listPressures().length,
      opportunities: world.worldDynamics.listOpportunities().length,
      commitments: world.worldDynamics.listCommitments().length,
      verification: dynamicsVerification.ok,
    },
    flowEntries: flowEntries.length,
    reports: reports.length,
    finalizedReports: finalizedReports.length,
    heapUsedBytes: process.memoryUsage().heapUsed,
    eventBus: world.bus.getDiagnostics(),
    validations: {
      lifecycle: lifecycleVerification.ok,
      resourceFlow: flowVerification.ok,
      resourceFlowTaskContexts: taskContextVerification.ok,
      dailyEconomy: economyVerification.ok,
      worldDynamics: dynamicsVerification.ok,
      toolMaintenance: maintenanceVerification.ok,
      toolMaintenanceRuntime: maintenanceRuntimeVerification.ok,
      publicToolGuarantee: toolCoverage.every((entry) => entry.protected),
      seedConservation: seedVerification.ok,
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

await mkdir(ARTIFACT_DIR, { recursive: true });
const artifactName = `stability-day${TARGET_DAY}-batch${BATCH_SIZE}.json`;
const artifactPath = `${ARTIFACT_DIR}/${artifactName}`;
const world = createLongRunAuditWorld(SEED);
const historicalDigests = new Map();
const checkpoints = [];
const startedAt = performance.now();
let previousTick = world.time.now().tick;

async function persistProgress(status, extra = {}) {
  const elapsedMs = performance.now() - startedAt;
  const report = {
    status,
    mode: 'headless',
    seed: SEED,
    targetDay: TARGET_DAY,
    targetMinute: TARGET_MINUTE,
    batchSize: BATCH_SIZE,
    totalTicks: targetTick(TARGET_DAY),
    elapsedMs: Math.round(elapsedMs),
    historicalReportsTracked: historicalDigests.size,
    checkpoints,
    replay: world.headlessReplay.getDiagnostics(),
    ...extra,
  };
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

try {
  await persistProgress('running');
  for (const day of checkpointDays(TARGET_DAY)) {
    const expectedTick = targetTick(day);
    const delta = expectedTick - previousTick;
    const replay = world.headlessReplay.advanceTicks(delta, { batchSize: BATCH_SIZE });
    const snapshot = auditCheckpoint(world, day, historicalDigests);
    snapshot.segment = {
      ticks: delta,
      batches: replay.batches,
      elapsedMs: replay.elapsedMs,
      ticksPerSecond: replay.ticksPerSecond,
    };
    assert.ok(snapshot.heapUsedBytes < MAX_HEAP_BYTES, `Heap usage exceeded limit: ${snapshot.heapUsedBytes}`);
    assert.ok(
      snapshot.segment.ticksPerSecond >= MIN_TICKS_PER_SECOND,
      `Long-run throughput fell below ${MIN_TICKS_PER_SECOND} ticks/s: ${snapshot.segment.ticksPerSecond}`,
    );
    checkpoints.push(snapshot);
    previousTick = expectedTick;
    await persistProgress('running', { completedThroughDay: day });
    console.log(
      `STABILITY_CHECKPOINT day=${day} batch=${BATCH_SIZE} mode=headless `
      + `ticksPerSecond=${snapshot.segment.ticksPerSecond} heap=${snapshot.heapUsedBytes} `
      + `active=${snapshot.activeTasks} reservations=${snapshot.reservations.total} `
      + `maintenance=${snapshot.maintenance.demands}/${snapshot.maintenance.activeTasks} `
      + `replacements=${snapshot.maintenance.replacements} generations=${JSON.stringify(snapshot.maintenance.generations)} `
      + `seeds=${snapshot.farming.seed.onHand}/${snapshot.farming.seed.target} seedTransit=${snapshot.farming.seed.inTransit} `
      + `fields=${snapshot.farming.fields}/${snapshot.farming.productiveFields} `
      + `dynamics=${snapshot.worldDynamics.summary.activePressures}/${snapshot.worldDynamics.summary.activeCommitments} `
      + `suppressed=${JSON.stringify(snapshot.eventBus.suppressedByEvent)}`,
    );
  }

  const elapsedMs = performance.now() - startedAt;
  const finalStateDigest = finalWorldStateDigest(world);
  const report = await persistProgress('pass', {
    elapsedMs: Math.round(elapsedMs),
    ticksPerSecond: Math.round(targetTick(TARGET_DAY) / Math.max(0.001, elapsedMs / 1000)),
    finalStateDigest,
  });
  console.log(`STABILITY_AUDIT=PASS day=${TARGET_DAY} batch=${BATCH_SIZE} mode=headless`);
  console.log(`STABILITY_FINAL_DIGEST=${report.finalStateDigest}`);
  console.log(`STABILITY_AUDIT_ARTIFACT=${artifactPath}`);
} catch (error) {
  await persistProgress('fail', {
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    currentTime: world.time.now(),
  });
  throw error;
} finally {
  world.restoreGlobals();
}
