import { buildPlanningStockTargets } from '../modules/actions/actionPlanner.js';

function actionCounts(runtime) {
  const result = {};
  runtime.actionSystem.getReservationLedger().list({ type: 'task-slot' }).forEach((entry) => {
    result[entry.key] = (result[entry.key] ?? 0) + 1;
  });
  return result;
}

function calculate(runtime) {
  const camp = runtime.campStore.get('starting-camp');
  const people = runtime.peopleSystem.getAliveRuntime?.() ?? runtime.peopleSystem.getAlive();
  return buildPlanningStockTargets({
    camp,
    population: people.length,
    people,
    storage: runtime.campStore.getStorage('starting-camp'),
    actionCounts: actionCounts(runtime),
  });
}

function ensureReadout() {
  const host = document.querySelector('.camp-stock');
  if (!host) return null;
  let readout = host.querySelector('#stock-target-detail');
  if (readout) return readout;
  readout = document.createElement('p');
  readout.id = 'stock-target-detail';
  readout.className = 'food-freshness-detail stock-target-detail';
  host.append(readout);
  return readout;
}

function formatResource(label, targets, key) {
  const effective = Math.round(Number(targets.amounts.effective[key] ?? 0));
  const goal = Math.round(Number(targets.goals[key] ?? 0));
  const incoming = Math.round(Number(targets.amounts.incoming[key] ?? 0));
  return `${label} ${effective}/${goal}${incoming > 0 ? `（在途 ${incoming}）` : ''}`;
}

function render(readout, targets) {
  if (!readout) return;
  const constraint = targets.capacity.constrained ? ' · 受当前容量约束' : '';
  readout.textContent = `三日目标 · ${formatResource('水', targets, 'water')} · ${formatResource('食物', targets, 'food')} · ${formatResource('木材', targets, 'wood')}${constraint}`;
}

export function attachStockTargetRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('动态库存目标启动失败：世界运行时尚未初始化。');
  if (runtime.stockTargetSystem) return runtime.stockTargetSystem;

  const readout = ensureReadout();
  let latest = calculate(runtime);
  render(readout, latest);

  function refresh() {
    latest = calculate(globalThis.shengling ?? runtime);
    render(readout, latest);
    return structuredClone(latest);
  }

  ['simulation:time', 'camp:changed', 'buildings:changed', 'actions:assigned', 'actions:completed', 'seasons:changed', 'environment:weather']
    .forEach((eventName) => eventBus.on(eventName, refresh));

  const api = Object.freeze({
    get: () => structuredClone(latest),
    refresh,
  });
  globalThis.shengling = Object.freeze({ ...runtime, stockTargetSystem: api });
  return api;
}
