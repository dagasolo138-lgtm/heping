import { createWorldDynamicsSystem } from '../modules/dynamics/worldDynamicsSystem.js';

const KIND_LABELS = Object.freeze({
  'stock-gap': '库存缺口',
  'survival-denial': '生存供给失败',
  spoilage: '腐败损失',
  'labor-backlog': '劳动积压',
  'seed-shortage': '粟种短缺',
  'soil-degradation': '土壤退化',
  'stock-surplus': '库存富余',
  'rain-sowing-window': '雨天播种窗口',
  'harvest-window': '成熟收获窗口',
});

const SUBJECT_LABELS = Object.freeze({
  food: '食物', water: '饮水', wood: '木材', milletSeed: '粟种',
  farmland: '农田', 'food-storage': '食物储存', 'community-labor': '聚落劳动',
});

function percent(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function labelFor(record) {
  const kind = KIND_LABELS[record.kind] ?? record.kind ?? '世界事实';
  const subject = SUBJECT_LABELS[record.subjectId] ?? record.subjectId;
  return subject ? `${kind} · ${subject}` : kind;
}

function detailFor(record) {
  if (record.kind === 'stock-gap') return `缺口 ${record.evidence?.gap ?? 0} / 目标 ${record.evidence?.goal ?? 0}`;
  if (record.kind === 'survival-denial') return `当日拒绝 ${record.evidence?.count ?? 0} 次`;
  if (record.kind === 'spoilage') return `损失占生产 ${percent(record.evidence?.ratio)}`;
  if (record.kind === 'labor-backlog') return `未完成任务 ${record.evidence?.backlog ?? 0}`;
  if (record.kind === 'seed-shortage') return `现有 ${record.evidence?.onHand ?? 0} / 目标 ${record.evidence?.target ?? 0}`;
  if (record.kind === 'soil-degradation') return `贫瘠 ${record.evidence?.poorFields ?? 0} · 瘠薄 ${record.evidence?.thinFields ?? 0}`;
  if (record.kind === 'stock-surplus') return `富余 ${record.evidence?.surplus ?? 0}`;
  if (record.kind === 'rain-sowing-window') return `可播种农田 ${record.evidence?.sowableFields ?? 0}`;
  if (record.kind === 'harvest-window') return `成熟农田 ${record.evidence?.matureFields ?? 0}`;
  return record.domain ?? '世界状态';
}

function emptyRow(text) {
  const item = document.createElement('li');
  item.className = 'dynamics-empty';
  item.textContent = text;
  return item;
}

function factCard(record, type) {
  const item = document.createElement('li');
  item.className = `dynamics-card dynamics-card--${type}`;
  const head = document.createElement('div');
  head.className = 'dynamics-card__head';
  const title = document.createElement('strong');
  title.textContent = labelFor(record);
  const value = document.createElement('b');
  value.textContent = type === 'pressure' ? percent(record.severity) : percent(record.value);
  head.append(title, value);
  const detail = document.createElement('p');
  detail.textContent = `${detailFor(record)} · 持续 ${record.persistenceDays ?? 1} 日`;
  item.append(head, detail);
  return item;
}

function commitmentCard(record) {
  const item = document.createElement('li');
  item.className = 'dynamics-card dynamics-card--commitment';
  const head = document.createElement('div');
  head.className = 'dynamics-card__head';
  const title = document.createElement('strong');
  title.textContent = SUBJECT_LABELS[record.goal?.itemId] ?? SUBJECT_LABELS[record.goal?.need] ?? record.type;
  const priority = document.createElement('b');
  priority.textContent = `优先级 ${record.priority}`;
  head.append(title, priority);
  const detail = document.createElement('p');
  detail.textContent = `目标 ${record.goal?.target ?? 0} ${record.goal?.unit ?? ''} · ${record.state === 'active' ? '执行中' : record.state}`;
  const progress = document.createElement('div');
  progress.className = 'dynamics-progress';
  const bar = document.createElement('i');
  bar.style.width = percent(record.progress);
  progress.append(bar);
  item.append(head, detail, progress);
  return item;
}

function renderOverview(system) {
  const host = document.querySelector('#dynamics-overview');
  if (!host) return;
  const summary = system.getSummary();
  const metrics = [
    ['压力', summary.activePressures],
    ['机会', summary.activeOpportunities],
    ['承诺', summary.activeCommitments],
  ];
  host.replaceChildren(...metrics.map(([label, amount]) => {
    const card = document.createElement('div');
    card.className = 'dynamics-metric';
    const caption = document.createElement('span');
    caption.textContent = label;
    const value = document.createElement('strong');
    value.textContent = String(amount);
    card.append(caption, value);
    return card;
  }));
}

function renderList(selector, records, type, emptyText) {
  const host = document.querySelector(selector);
  if (!host) return;
  const nodes = records.length
    ? records.map((record) => type === 'commitment' ? commitmentCard(record) : factCard(record, type))
    : [emptyRow(emptyText)];
  host.replaceChildren(...nodes);
}

function render(system) {
  renderOverview(system);
  renderList('#dynamics-pressure-list', system.listPressures({ state: 'active' }), 'pressure', '暂无持续压力');
  renderList('#dynamics-opportunity-list', system.listOpportunities({ state: 'active' }), 'opportunity', '暂无明显机会');
  renderList('#dynamics-commitment-list', system.listCommitments({ state: 'active' }), 'commitment', '尚未形成共同承诺');
}

export function attachWorldDynamicsRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('世界动力系统启动失败：世界运行时尚未初始化。');
  if (!runtime.dailyEconomySystem) throw new Error('世界动力系统启动失败：每日经济尚未初始化。');
  if (runtime.worldDynamicsSystem) return runtime.worldDynamicsSystem;

  const worldDynamicsSystem = createWorldDynamicsSystem({
    eventBus,
    gameTime: runtime.gameTime,
    getRuntime: () => globalThis.shengling,
  });

  eventBus.on('daily-economy:finalized', ({ report }) => {
    const decorated = runtime.dailyEconomySystem.getReport?.(report?.year, report?.day) ?? report;
    if (decorated) worldDynamicsSystem.evaluate(decorated);
  });
  ['world-dynamics:evaluated', 'world-dynamics:hydrated', 'world-dynamics:reset']
    .forEach((eventName) => eventBus.on(eventName, () => render(worldDynamicsSystem)));

  globalThis.shengling = Object.freeze({ ...runtime, worldDynamicsSystem });
  render(worldDynamicsSystem);
  return worldDynamicsSystem;
}
