import { createToolSystem } from '../modules/tools/toolSystem.js';

function ensureReadout() {
  const host = document.querySelector('.camp-stock');
  if (!host) return null;
  let readout = host.querySelector('#tool-inventory-detail');
  if (readout) return readout;
  readout = document.createElement('p');
  readout.id = 'tool-inventory-detail';
  readout.className = 'food-freshness-detail tool-inventory-detail';
  host.append(readout);
  return readout;
}

function render(readout, toolSystem) {
  if (!readout) return;
  const tools = toolSystem.list();
  const assignments = new Map(toolSystem.getAssignments().map((entry) => [entry.toolId, entry]));
  readout.textContent = tools.map((tool) => {
    const assignment = assignments.get(tool.id);
    const durability = `${Math.round(tool.durability)}/${Math.round(tool.maxDurability)}`;
    const state = tool.status === 'broken' ? '损坏' : assignment ? '使用中' : '可用';
    return `${tool.label} ${durability}（${state}）`;
  }).join(' · ');
}

export function attachToolRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('工具模块启动失败：世界运行时尚未初始化。');
  if (runtime.toolSystem) return runtime.toolSystem;

  const toolSystem = createToolSystem({
    eventBus,
    gameTime: runtime.gameTime,
    reservationLedger: runtime.reservationLedger,
    getRuntime: () => globalThis.shengling,
  });
  const readout = ensureReadout();
  render(readout, toolSystem);

  eventBus.on('actions:assigned', ({ personId, task }) => {
    toolSystem.reserveForTask({ personId, task });
  });
  eventBus.on('people:changed', ({ reason, person }) => {
    if (reason === 'activity:set' && !person?.activity?.current) {
      toolSystem.releaseReservationForOwner(person.id);
    }
  });
  eventBus.on('actions:completed', ({ personId, task }) => {
    toolSystem.completeTask({ personId, task });
  });
  eventBus.on('simulation:tick', () => {
    toolSystem.reconcile();
  });
  eventBus.on('tools:changed', () => render(readout, toolSystem));
  eventBus.on('save:loaded', () => {
    toolSystem.reconcile(new Set());
    render(readout, toolSystem);
  });

  globalThis.shengling = Object.freeze({ ...runtime, toolSystem });
  return toolSystem;
}
