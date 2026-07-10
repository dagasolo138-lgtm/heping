import { createEventBus } from './core/events/eventBus.js';
import { createGameTime } from './core/time/gameTime.js';
import { createUiRenderScheduler } from './core/ui/uiRenderScheduler.js';
import { createPeopleSystem } from './modules/people/peopleSystem.js';
import { createFounders } from './modules/people/createFounders.js';
import { createMapSystem } from './modules/map/mapSystem.js';
import { placeStartingSettlers } from './modules/map/placeStartingSettlers.js';
import { createCampStore, CAMP_ITEM_LABELS } from './modules/settlements/campStore.js';
import { createCampRulesSystem } from './modules/settlements/campRules.js';
import { createBuildingSystem } from './modules/buildings/buildingSystem.js';
import { createWeatherSystem } from './modules/environment/weatherSystem.js';
import { createFireSystem } from './modules/environment/fireSystem.js';
import { getExposure } from './modules/environment/exposureSystem.js';
import { createActionSystem } from './modules/actions/actionSystem.js';
import { createSocialEventSystem } from './modules/social/socialEventSystem.js';
import { createChronicleSystem } from './modules/history/chronicleSystem.js';
import { createLlmBoundary } from './modules/ai/llmBoundary.js';
import { createMapView } from './ui/map/mapView.js';
import { occupationLabel } from './data/constants/occupations.js';
import { traitLabel } from './data/constants/traits.js';
import { getAge } from './modules/people/personLifecycle.js';

const bus = createEventBus();
const time = createGameTime({ year: 1, day: 1, minute: 480 });
const people = createPeopleSystem({ eventBus: bus, gameTime: time });
const map = createMapSystem({ eventBus: bus, gameTime: time });
const camp = createCampStore({ eventBus: bus, gameTime: time });
const campRules = createCampRulesSystem({ eventBus: bus, gameTime: time });
const buildings = createBuildingSystem({ eventBus: bus, gameTime: time });
const weather = createWeatherSystem({ eventBus: bus, gameTime: time });

createFounders(people);
const valley = map.createStartingValley();
placeStartingSettlers({ peopleSystem: people, map: valley });
camp.create({
  id: 'starting-camp',
  label: '起始营地',
  anchor: valley.spawnPoint,
  items: { wood: 3, berries: 2, water: 1 },
  capacity: 24,
  storageLabel: '营地露天堆放',
});
const fire = createFireSystem({ eventBus: bus, gameTime: time, mapSystem: map });
const actions = createActionSystem({
  peopleSystem: people,
  mapSystem: map,
  campStore: camp,
  buildingSystem: buildings,
  weatherSystem: weather,
  fireSystem: fire,
  campRulesSystem: campRules,
  eventBus: bus,
  gameTime: time,
});

const $ = (selector) => document.querySelector(selector);
const peopleList = $('#people-list');
const detail = $('#person-detail');
const count = $('#people-count');
const status = $('#system-status');
const clock = $('#world-time');
const topbarTime = $('#topbar-time');
const weatherReadout = $('#weather-readout');
const resources = $('#camp-resources');
const construction = $('#construction-status');
const log = $('#action-log');
let chroniclePanel = null;
let selectedId = people.list()[0]?.id;
const diagnostics = {
  lastTickAt: null,
  lastGameTime: time.stamp(),
  renderCount: 0,
  scheduledRenderCount: 0,
  lastRenderReason: 'initial',
  actionLoopRunning: false,
  lastSimulationError: null,
};

const view = createMapView({
  canvas: $('#map-canvas'),
  mapSystem: map,
  peopleSystem: people,
  getRenderPeople: () => actions.getRenderPeople(),
  getRenderBuildings: () => buildings.list(),
  getDayPhase: () => actions.getDayPhase(),
  getWeather: () => actions.getWeather(),
  getFire: () => actions.getFire(),
  controls: [...document.querySelectorAll('[data-map-control]')],
  onPersonSelect: (id) => select(id, false),
  onReadout: ({ x, y, zoom }) => {
    const readout = $('#map-readout');
    if (readout) readout.textContent = `坐标 ${x}, ${y} · ${Math.round(zoom)} px/m`;
  },
});
const socialEvents = createSocialEventSystem({
  eventBus: bus,
  peopleSystem: people,
  gameTime: time,
  getRuntimePeople: () => actions.getRenderPeople(),
});
const chronicles = createChronicleSystem({ eventBus: bus, gameTime: time, peopleSystem: people });
const llmBoundary = createLlmBoundary({ peopleSystem: people, chronicleSystem: chronicles });

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function conditionLabel(tag) {
  return ({
    sleeping: '睡眠中', sheltered: '有住所', exposed: '露宿',
    soaked: '淋湿', chilled: '受寒', warm: '温暖', dry: '干燥',
  }[tag] ?? tag);
}

function factorLabel(key) {
  return ({
    personalNeed: '个人需求', campScarcity: '营地稀缺', skillFit: '技能适配', roleFit: '职业倾向',
    traitBias: '性格倾向', distance: '距离成本', crowding: '并发拥挤', social: '社会因素',
    emergency: '紧急程度', cargo: '携带物资', campStorage: '营地容量', cold: '受寒', wetness: '潮湿',
  }[key] ?? key);
}

function renderUtilityDebug(utility) {
  if (!utility) return '<section class="utility-card utility-card--empty"><h3>行动原因</h3><p class="muted">当前行动尚未接入效用评分，或正在待命。</p></section>';
  const factorRows = Object.entries(utility.factors ?? {})
    .sort(([, first], [, second]) => Math.abs(Number(second)) - Math.abs(Number(first)))
    .slice(0, 5)
    .map(([key, value]) => `<li><span>${esc(factorLabel(key))}</span><strong>${Number(value) > 0 ? '+' : ''}${esc(value)}</strong></li>`)
    .join('');
  const candidateRows = (utility.candidates ?? []).slice(0, 4)
    .map((candidate) => `<li><span>${esc(candidate.label ?? candidate.type)}</span><strong>${esc(candidate.score)}</strong><small>${esc(candidate.reason ?? '')}</small></li>`)
    .join('');
  return `<section class="utility-card"><div class="utility-card__header"><h3>行动原因</h3><span>${esc(utility.planner ?? 'utility')} · ${esc(utility.score ?? 0)} 分</span></div>
    <p>${esc(utility.reason ?? '暂无原因')}</p>
    <details><summary>展开评分细节</summary>
      ${factorRows ? `<ul class="utility-factors">${factorRows}</ul>` : '<p class="muted">暂无 utility factors。</p>'}
      ${candidateRows ? `<div class="utility-candidates"><h4>候选评分</h4><ol>${candidateRows}</ol></div>` : ''}
    </details>
  </section>`;
}

function renderEnvironment() {
  const currentWeather = actions.getWeather();
  const currentFire = actions.getFire();
  const fireLabel = currentFire.lit ? `篝火燃料 ${currentFire.fuel.toFixed(1)}` : '篝火已熄灭';
  weatherReadout.textContent = `${currentWeather.label} · ${currentWeather.temperature}℃ · ${fireLabel}`;
  weatherReadout.classList.toggle('is-rain', currentWeather.isRain);
  weatherReadout.setAttribute('aria-label', `天气与篝火：${weatherReadout.textContent}`);
}

function select(id, focus = true) {
  selectedId = id;
  const runtime = actions.getRenderPeople().find((person) => person.id === id) ?? people.get(id);
  view.setSelectedPerson(id);
  if (focus) view.focusPerson(runtime);
  uiScheduler.flush('person:selected');
  document.dispatchEvent(new CustomEvent('observer:person-selected', { detail: { personId: id } }));
}

function renderPeople() {
  const list = people.list({ sortBy: 'birth' });
  count.textContent = list.length;
  peopleList.innerHTML = list.map((person) => {
    const active = person.id === selectedId ? 'is-active' : '';
    const age = getAge(person, time.now());
    const current = person.activity.current?.label ?? '待命';
    return `<button class="person-row ${active}" data-person-id="${person.id}">
      <span class="portrait portrait--small">${esc(person.identity.name.slice(-1))}</span>
      <span class="person-row__copy"><strong>${esc(person.identity.name)}</strong><small>${age} 岁 · ${occupationLabel(person.work.occupation)} · ${esc(current)}</small></span>
      <span class="person-row__health">${Math.round(person.state.health)}</span>
    </button>`;
  }).join('');
}

function renderDetail() {
  const person = people.get(selectedId);
  if (!person) return;
  const runtime = actions.getRenderPeople().find((item) => item.id === person.id) ?? person;
  const home = person.location.homeId ? buildings.get(person.location.homeId) : null;
  const current = person.activity.current;
  const exposure = getExposure(person);
  const skillRows = Object.entries(person.work.skills).filter(([, value]) => value > 0).sort(([, a], [, b]) => b - a).slice(0, 4)
    .map(([name, value]) => `<div><span>${esc(name)}</span><b>${value}</b></div>`).join('');
  const events = person.memories.lifeEvents.slice(-4).reverse().map((event) => `<li><time>${esc(event.time.label)}</time><p>${esc(event.summary)}</p></li>`).join('');
  const personalMemories = person.memories.personal.slice(-5).reverse()
    .map((memory) => `<li><time>${esc(memory.time.label)}</time><p>${esc(memory.summary)}</p><small>${memory.details?.source === 'rumor' ? '听闻' : memory.details?.source === 'direct' ? '亲历' : esc(memory.type)}</small></li>`)
    .join('');
  const items = Object.entries(person.inventory.items).map(([name, value]) => `${CAMP_ITEM_LABELS[name] ?? name} ×${value}`).join('、') || '空';
  const conditions = person.state.statusTags.map((tag) => `<span class="tag">${esc(conditionLabel(tag))}</span>`).join('');
  detail.innerHTML = `
    <div class="person-hero"><div class="portrait portrait--large">${esc(person.identity.name.slice(-1))}</div><div>
      <p class="panel__kicker">PERSON RECORD / REV ${person.revision}</p><h2>${esc(person.identity.name)}</h2>
      <p class="person-hero__meta">${getAge(person, time.now())} 岁 · ${occupationLabel(person.work.occupation)} · ${home ? esc(home.label) : '露宿营地'}</p>
      <div class="tag-row">${person.traits.map((trait) => `<span class="tag">${traitLabel(trait)}</span>`).join('')}${conditions}</div>
    </div></div>
    <div class="activity-banner ${current ? '' : 'activity-banner--idle'}"><span class="activity-banner__dot"></span><div><small>当前行动</small><strong>${current ? `${esc(current.label)} · ${esc(current.phase)}` : '待命'}</strong></div></div>
    ${renderUtilityDebug(current?.utility)}
    <div class="exposure-summary"><span>潮湿 ${Math.round(exposure.wetness)} / 100</span><span>受寒 ${Math.round(exposure.cold)} / 100</span></div>
    <div class="metrics-grid">
      <div class="metric"><span>饥饿</span><strong>${Math.round(person.state.hunger)}</strong></div>
      <div class="metric"><span>口渴</span><strong>${Math.round(person.state.thirst)}</strong></div>
      <div class="metric"><span>精力</span><strong>${Math.round(person.state.energy)}</strong></div>
      <div class="metric"><span>健康</span><strong>${Math.round(person.state.health)}</strong></div>
      <div class="metric"><span>位置</span><strong>${runtime.location.tileX.toFixed(1)}, ${runtime.location.tileY.toFixed(1)}</strong></div>
      <div class="metric"><span>库存</span><strong>${Object.keys(person.inventory.items).length}</strong></div>
      <div class="metric"><span>行动</span><strong>${person.activity.completedCount ?? 0}</strong></div>
    </div>
    <div class="detail-columns"><section class="detail-card"><h3>技能倾向</h3><div class="skill-list">${skillRows}</div><p class="muted">${esc(person.work.preferences.join('、') || '暂无偏好')}</p></section>
      <section class="detail-card"><h3>生活状态</h3><p>居所：${home ? esc(home.label) : '露宿营地'}</p><p>环境：${person.state.statusTags.includes('exposed') ? '露宿时恢复较慢' : home ? '草棚可阻隔雨寒' : '尚未结算'}</p><p>物品：${esc(items)}</p></section>
      <section class="detail-card"><h3>人物关系</h3><p>伴侣：${person.family.spouseId ? '已有伴侣' : '无'}</p><p>手足：${person.family.siblingIds.length} 人</p><p>子女：${person.family.childIds.length} 人</p></section></div>
    <section class="history-card"><div class="history-card__header"><h3>人生事实</h3><span>${person.memories.lifeEvents.length} 条</span></div><ol>${events}</ol></section>
    <section class="history-card"><div class="history-card__header"><h3>亲历与听闻</h3><span>${person.memories.personal.length} 条</span></div><ol>${personalMemories || '<li><p class="muted">暂无共同记忆。</p></li>'}</ol></section>`;
}

function renderCamp() {
  const campState = camp.get('starting-camp');
  const items = campState?.items ?? {};
  const storage = camp.getStorage('starting-camp');
  const currentFire = actions.getFire();
  const berries = Number(items.berries ?? 0);
  const millet = Number(items.millet ?? 0);
  const foodTotal = berries + millet;
  const stock = [
    `<span class="resource-chip resource-chip--water"><b>水</b><strong>${Number(items.water ?? 0)}</strong></span>`,
    `<span class="resource-chip resource-chip--food"><b>食物</b><strong>${foodTotal}</strong><small>浆果 ${berries} · 粟米 ${millet}</small></span>`,
    `<span class="resource-chip resource-chip--wood"><b>木材</b><strong>${Number(items.wood ?? 0)}</strong></span>`,
  ];
  stock.push(`<span class="resource-chip resource-chip--fire ${currentFire.lit ? '' : 'is-out'}"><b>篝火</b><strong>${currentFire.lit ? currentFire.fuel.toFixed(1) : '熄灭'}</strong></span>`);
  if (storage) stock.push(`<span class="resource-chip resource-chip--storage"><b>储存容量</b><strong>${storage.used}/${storage.capacity}</strong><small>${esc(storage.label)}</small></span>`);
  stock.push('<span class="resource-chip resource-chip--rule"><b>食物规则</b><strong>先到先得</strong><small>其他规则仅解释记录，暂未参与排序</small></span>');
  resources.innerHTML = stock.join('');
}

function renderConstruction() {
  const building = buildings.list({ includeCompleted: false })[0]
    ?? buildings.completedByType('storageShed')
    ?? buildings.completedByType('communalShelter');
  if (!building) {
    construction.innerHTML = '<p class="muted">正在规划聚落的第一处工地。</p>';
    return;
  }
  const data = buildings.getConstructionSummary(building.id);
  const materialRows = Object.entries(data.materials.required)
    .map(([itemId, amount]) => `${CAMP_ITEM_LABELS[itemId] ?? itemId} <b>${Number(data.materials.delivered[itemId] ?? 0)}</b> / ${amount}`)
    .join(' · ');
  const percent = Math.round(data.progress * 100);
  const label = data.status === 'complete' ? '已建成' : data.materialsReady ? '施工中' : '筹集材料';
  const completedDetail = data.typeId === 'storageShed'
    ? `储存容量 +${data.effects.storageCapacity} · 遮蔽保护 +${Math.round(data.effects.storageProtection * 100)}%`
    : `已入住 ${data.occupants.length} 人 · 夜间提供睡位`;
  construction.innerHTML = `<div class="construction-line"><strong>${esc(data.label)}</strong><span>${label}</span></div>
    <div class="construction-material">${materialRows}</div>
    <div class="progress-track"><i style="width:${percent}%"></i></div>
    <div class="construction-footnote">施工进度 ${percent}% · ${data.status === 'complete' ? completedDetail : esc(data.description)}</div>`;
}

function renderLog() {
  log.innerHTML = actions.getRecentLogs(5).map((entry) => `<li><time>${esc(entry.time.label.split(' ').at(-1))}</time><span>${esc(entry.summary)}</span></li>`).join('');
}

function ensureChroniclePanel() {
  if (chroniclePanel) return chroniclePanel;
  chroniclePanel = document.querySelector('#chronicle-panel');
  if (chroniclePanel) return chroniclePanel;
  chroniclePanel = document.createElement('section');
  chroniclePanel.id = 'chronicle-panel';
  chroniclePanel.className = 'chronicle-panel panel';
  chroniclePanel.innerHTML = '<div class="panel__header"><div><p class="panel__kicker">SETTLEMENT CHRONICLE</p><h2>聚落纪事</h2></div><span class="count-pill" data-chronicle-count>0</span></div><ol class="chronicle-list is-collapsed" data-chronicle-list></ol><button type="button" class="chronicle-toggle" data-chronicle-toggle>展开全部纪事</button>';
  chroniclePanel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chronicle-toggle]');
    if (!button) return;
    const list = chroniclePanel.querySelector('[data-chronicle-list]');
    const collapsed = list?.classList.toggle('is-collapsed');
    button.textContent = collapsed ? '展开全部纪事' : '收起纪事';
  });
  const host = document.querySelector('[data-chronicle-host]');
  if (host) host.append(chroniclePanel);
  else document.querySelector('.workspace')?.insertAdjacentElement('afterend', chroniclePanel);
  return chroniclePanel;
}

function renderChronicles() {
  const panel = ensureChroniclePanel();
  const list = panel.querySelector('[data-chronicle-list]');
  const countNode = panel.querySelector('[data-chronicle-count]');
  const items = chronicles.listChronicles();
  if (countNode) countNode.textContent = items.length;
  if (!list) return;
  list.innerHTML = items.length ? items.map((entry) => {
    const rows = (entry.entries ?? []).slice(0, 3).map((item) => `<li><time>${esc(item.time?.label ?? '')}</time><span>${esc(item.text)}</span></li>`).join('');
    return `<li class="chronicle-entry"><div class="chronicle-entry__head"><strong>${esc(entry.title)}</strong><small>${esc(entry.createdAt?.label ?? '')} · ${entry.locked ? '已锁定' : '草稿'}</small></div><p>${esc(entry.summary)}</p><ol>${rows}</ol></li>`;
  }).join('') : '<li class="chronicle-entry chronicle-entry--empty"><p class="muted">尚未生成聚落纪事。建筑完成、资源危机、规则变化或每十日周期会留下不可修改的史书条目。</p></li>';
}

function render(reasons = []) {
  diagnostics.renderCount += 1;
  diagnostics.actionLoopRunning = actions.isRunning();
  diagnostics.lastGameTime = time.stamp();
  diagnostics.lastRenderReason = reasons.join(', ') || diagnostics.lastRenderReason;
  renderPeople();
  renderDetail();
  renderCamp();
  renderConstruction();
  renderEnvironment();
  renderLog();
  renderChronicles();
  view.setSelectedPerson(selectedId);
  view.redraw();
}

const uiScheduler = createUiRenderScheduler({
  maxFps: 10,
  render: (reasons) => render(reasons),
});

function scheduleRender(reason = 'unspecified') {
  diagnostics.scheduledRenderCount += 1;
  uiScheduler.request(reason);
}

diagnostics.getUiScheduler = () => uiScheduler.getDiagnostics();

peopleList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-person-id]');
  if (row) select(row.dataset.personId);
});

bus.on('people:changed', ({ person, reason }) => {
  if (reason === 'activity:set' && person.activity.current && status) status.textContent = `${person.identity.name}：${person.activity.current.label} · ${person.activity.current.phase}`;
  scheduleRender(`people:${reason ?? 'changed'}`);
});
bus.on('camp:changed', () => scheduleRender('camp:changed'));
bus.on('buildings:changed', () => scheduleRender('buildings:changed'));
bus.on('buildings:completed', ({ building }) => {
  if (building.typeId === 'communalShelter') {
    const residents = people.getAlive().map((person) => person.id);
    buildings.assignOccupants(building.id, residents);
    residents.forEach((id) => people.setLocation(id, { homeId: building.id }));
    if (status) status.textContent = '集体草棚建成，十位村民第一次有了遮蔽之所。';
  }
  if (building.typeId === 'storageShed') {
    camp.applyStorageUpgrade('starting-camp', {
      sourceBuildingId: building.id,
      label: building.label,
      capacityDelta: building.effects.storageCapacity,
      protectionDelta: building.effects.storageProtection,
    });
    if (status) status.textContent = '简易储物棚建成，营地物资有了更大的遮蔽空间。';
  }
  scheduleRender('buildings:completed');
});
bus.on('actions:log', ({ entry }) => {
  if (status) status.textContent = entry.summary;
  scheduleRender('actions:log');
});
bus.on('history:chronicle-created', ({ chronicle }) => {
  if (status) status.textContent = `聚落纪事写成：${chronicle.title}`;
  scheduleRender('history:chronicle-created');
});
bus.on('history:chronicles-hydrated', () => scheduleRender('history:chronicles-hydrated'));
bus.on('environment:phase', ({ phase }) => {
  if (status) status.textContent = phase.isNight ? '夜幕降临，村民正回到营地与住所。' : `${phase.label}，起始河谷正在苏醒。`;
  scheduleRender('environment:phase');
});
bus.on('environment:weather', ({ weather: currentWeather }) => {
  if (status) status.textContent = `天气转为${currentWeather.label}，气温 ${currentWeather.temperature}℃。`;
  scheduleRender('environment:weather');
});
bus.on('environment:fire', () => scheduleRender('environment:fire'));
bus.on('environment:updated', () => scheduleRender('environment:updated'));
bus.on('simulation:time', ({ time: stamp, phase }) => {
  diagnostics.lastTickAt = Date.now();
  diagnostics.lastGameTime = stamp;
  if (clock) clock.innerHTML = `<span class="map-overlay__dot"></span>${esc(phase?.label ?? '')} · ${esc(stamp.label)}`;
  if (topbarTime) topbarTime.textContent = stamp.label.replace(/^生灵历\s*/, '');
  scheduleRender('simulation:time');
});
bus.on('simulation:error', ({ summary }) => {
  diagnostics.lastSimulationError = summary;
  diagnostics.actionLoopRunning = false;
  if (status) status.textContent = `模拟已暂停：${summary?.message ?? '未知错误'}`;
});
bus.on('map:changed', ({ map: nextMap }) => {
  view.setMap(nextMap);
  scheduleRender('map:changed');
});

window.shengling = Object.freeze({
  peopleSystem: people,
  mapSystem: map,
  campStore: camp,
  buildingSystem: buildings,
  weatherSystem: weather,
  fireSystem: fire,
  campRulesSystem: campRules,
  socialEventSystem: socialEvents,
  chronicleSystem: chronicles,
  llmBoundary,
  actionSystem: actions,
  reservationLedger: actions.getReservationLedger(),
  gameTime: time,
  mapView: view,
  requestUiRender: scheduleRender,
  uiScheduler,
  diagnostics,
});
uiScheduler.flush('initial');
actions.start();
