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

function conditionLabel(tool, assignment, maintenanceReservation, demand) {
  if (maintenanceReservation?.mode === 'replace') return '替换制作中';
  if (maintenanceReservation) return tool.status === 'broken' ? '维修中·原已损坏' : '维修中';
  if (demand?.mode === 'replace') return demand.guaranteeGap ? '保障缺口·急需替换' : '达到寿命·待替换';
  if (tool.status === 'broken') return '损坏·急需维修';
  if (assignment) return tool.condition === 'critical' ? '使用中·严重磨损' : tool.condition === 'worn' ? '使用中·低耐久' : '使用中';
  if (tool.condition === 'critical') return '严重磨损·急需维修';
  if (tool.condition === 'worn') return '低耐久·待维修';
  return '可用';
}

function materialLabel(materials = {}) {
  const labels = { wood: '木料', berries: '浆果', water: '水', millet: '粟米' };
  return Object.entries(materials)
    .filter(([, amount]) => Number(amount) > 0)
    .map(([itemId, amount]) => `${labels[itemId] ?? itemId}${Number(amount)}`)
    .join('+');
}

function render(readout, toolSystem) {
  if (!readout) return;
  const tools = toolSystem.list();
  const assignments = new Map(toolSystem.getAssignments().map((entry) => [entry.toolId, entry]));
  const demands = new Map(toolSystem.listMaintenanceDemands().map((entry) => [entry.toolId, entry]));
  const coverage = new Map(toolSystem.getCoverage().map((entry) => [entry.typeId, entry]));
  const maintenanceReservations = new Map(
    (globalThis.shengling?.toolMaintenanceRuntime?.listReservations?.() ?? []).map((entry) => [entry.toolId, entry]),
  );
  const rows = tools.map((tool) => {
    const assignment = assignments.get(tool.id);
    const demand = demands.get(tool.id);
    const maintenanceReservation = maintenanceReservations.get(tool.id);
    const durability = `${Math.round(tool.durability)}/${Math.round(tool.maxDurability)}`;
    const maintenance = demand
      ? `；${demand.mode === 'replace' ? '替换' : '维修'}需${materialLabel(demand.materials)}、${Math.round(demand.workMinutes)}分钟`
      : '';
    return `${tool.label}·第${tool.generation}代 ${durability}（${conditionLabel(tool, assignment, maintenanceReservation, demand)}${maintenance}）`;
  });
  const guarantee = [...coverage.values()]
    .map((entry) => `${entry.label}${entry.usable}/${entry.required}${entry.gap > 0 ? '·恢复中' : ''}`)
    .join('、');
  readout.textContent = `${rows.join(' · ')}；公共保障：${guarantee}`;
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
  eventBus.on('tool-maintenance:changed', () => render(readout, toolSystem));
  eventBus.on('save:loaded', () => {
    toolSystem.reconcile(new Set());
    render(readout, toolSystem);
  });

  globalThis.shengling = Object.freeze({ ...runtime, toolSystem });
  return toolSystem;
}
