import { createEventBus } from './core/events/eventBus.js';
import { createGameTime } from './core/time/gameTime.js';
import { createPeopleSystem } from './modules/people/peopleSystem.js';
import { createFounders } from './modules/people/createFounders.js';
import { createMapSystem } from './modules/map/mapSystem.js';
import { placeStartingSettlers } from './modules/map/placeStartingSettlers.js';
import { createCampStore, CAMP_ITEM_LABELS } from './modules/settlements/campStore.js';
import { createBuildingSystem } from './modules/buildings/buildingSystem.js';
import { createActionSystem } from './modules/actions/actionSystem.js';
import { createMapView } from './ui/map/mapView.js';
import { occupationLabel } from './data/constants/occupations.js';
import { traitLabel } from './data/constants/traits.js';
import { getAge } from './modules/people/personLifecycle.js';

const bus = createEventBus();
const time = createGameTime({ year: 1, day: 1, minute: 480 });
const people = createPeopleSystem({ eventBus: bus, gameTime: time });
const map = createMapSystem({ eventBus: bus, gameTime: time });
const camp = createCampStore({ eventBus: bus, gameTime: time });
const buildings = createBuildingSystem({ eventBus: bus, gameTime: time });

createFounders(people);
const valley = map.createStartingValley();
placeStartingSettlers({ peopleSystem: people, map: valley });
camp.create({ id: 'starting-camp', label: '起始营地', anchor: valley.spawnPoint, items: { wood: 3, berries: 2, water: 1 } });
const actions = createActionSystem({ peopleSystem: people, mapSystem: map, campStore: camp, buildingSystem: buildings, eventBus: bus, gameTime: time });

const $ = (selector) => document.querySelector(selector);
const peopleList = $('#people-list');
const detail = $('#person-detail');
const count = $('#people-count');
const status = $('#system-status');
const clock = $('#world-time');
const resources = $('#camp-resources');
const construction = $('#construction-status');
const log = $('#action-log');
let selectedId = people.list()[0]?.id;

const view = createMapView({
  canvas: $('#map-canvas'),
  mapSystem: map,
  peopleSystem: people,
  getRenderPeople: () => actions.getRenderPeople(),
  getRenderBuildings: () => buildings.list(),
  getDayPhase: () => actions.getDayPhase(),
  controls: [...document.querySelectorAll('[data-map-control]')],
  onPersonSelect: (id) => select(id, false),
  onReadout: ({ x, y, zoom }) => { $('#map-readout').textContent = `坐标 ${x}, ${y} · ${Math.round(zoom)} px/m`; },
});

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function conditionLabel(tag) {
  return ({ sleeping: '睡眠中', sheltered: '有住所', exposed: '露宿' }[tag] ?? tag);
}

function select(id, focus = true) {
  selectedId = id;
  const runtime = actions.getRenderPeople().find((person) => person.id === id) ?? people.get(id);
  view.setSelectedPerson(id);
  if (focus) view.focusPerson(runtime);
  render();
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
  const skillRows = Object.entries(person.work.skills).filter(([, value]) => value > 0).sort(([, a], [, b]) => b - a).slice(0, 4)
    .map(([name, value]) => `<div><span>${esc(name)}</span><b>${value}</b></div>`).join('');
  const events = person.memories.lifeEvents.slice(-4).reverse().map((event) => `<li><time>${esc(event.time.label)}</time><p>${esc(event.summary)}</p></li>`).join('');
  const items = Object.entries(person.inventory.items).map(([name, value]) => `${CAMP_ITEM_LABELS[name] ?? name} ×${value}`).join('、') || '空';
  const conditions = person.state.statusTags.map((tag) => `<span class="tag">${esc(conditionLabel(tag))}</span>`).join('');
  detail.innerHTML = `
    <div class="person-hero"><div class="portrait portrait--large">${esc(person.identity.name.slice(-1))}</div><div>
      <p class="panel__kicker">PERSON RECORD / REV ${person.revision}</p><h2>${esc(person.identity.name)}</h2>
      <p class="person-hero__meta">${getAge(person, time.now())} 岁 · ${occupationLabel(person.work.occupation)} · ${home ? esc(home.label) : '露宿营地'}</p>
      <div class="tag-row">${person.traits.map((trait) => `<span class="tag">${traitLabel(trait)}</span>`).join('')}${conditions}</div>
    </div></div>
    <div class="activity-banner ${current ? '' : 'activity-banner--idle'}"><span class="activity-banner__dot"></span><div><small>当前行动</small><strong>${current ? `${esc(current.label)} · ${esc(current.phase)}` : '待命'}</strong></div></div>
    <div class="metrics-grid">
      <div class="metric"><span>饥饿</span><strong>${Math.round(person.state.hunger)}</strong></div>
      <div class="metric"><span>口渴</span><strong>${Math.round(person.state.thirst)}</strong></div>
      <div class="metric"><span>精力</span><strong>${Math.round(person.state.energy)}</strong></div>
      <div class="metric"><span>位置</span><strong>${runtime.location.tileX.toFixed(1)}, ${runtime.location.tileY.toFixed(1)}</strong></div>
      <div class="metric"><span>库存</span><strong>${Object.keys(person.inventory.items).length}</strong></div>
      <div class="metric"><span>行动</span><strong>${person.activity.completedCount ?? 0}</strong></div>
    </div>
    <div class="detail-columns"><section class="detail-card"><h3>技能倾向</h3><div class="skill-list">${skillRows}</div><p class="muted">${esc(person.work.preferences.join('、') || '暂无偏好')}</p></section>
      <section class="detail-card"><h3>生活状态</h3><p>居所：${home ? esc(home.label) : '露宿营地'}</p><p>夜间条件：${person.state.statusTags.includes('exposed') ? '露宿，恢复较慢且压力增加' : home ? '有草棚遮蔽，睡眠恢复加成' : '尚未结算'}</p><p>物品：${esc(items)}</p></section>
      <section class="detail-card"><h3>人物关系</h3><p>伴侣：${person.family.spouseId ? '已有伴侣' : '无'}</p><p>手足：${person.family.siblingIds.length} 人</p><p>子女：${person.family.childIds.length} 人</p></section></div>
    <section class="history-card"><div class="history-card__header"><h3>人生事实</h3><span>${person.memories.lifeEvents.length} 条</span></div><ol>${events}</ol></section>`;
}

function renderCamp() {
  const items = camp.get('starting-camp')?.items ?? {};
  resources.innerHTML = ['water', 'berries', 'wood'].map((name) => `<span class="resource-chip resource-chip--${name}"><b>${CAMP_ITEM_LABELS[name]}</b><strong>${Number(items[name] ?? 0)}</strong></span>`).join('');
}

function renderConstruction() {
  const building = buildings.activeByType('communalShelter') ?? buildings.completedByType('communalShelter');
  if (!building) {
    construction.innerHTML = '<p class="muted">正在划定第一处工地。</p>';
    return;
  }
  const data = buildings.getConstructionSummary(building.id);
  const wood = Number(data.materials.delivered.wood ?? 0);
  const needed = Number(data.materials.required.wood ?? 0);
  const percent = Math.round(data.progress * 100);
  const label = data.status === 'complete' ? '已建成' : data.materialsReady ? '施工中' : '筹集材料';
  construction.innerHTML = `<div class="construction-line"><strong>${esc(data.label)}</strong><span>${label}</span></div>
    <div class="construction-material">木材 <b>${wood}</b> / ${needed}</div>
    <div class="progress-track"><i style="width:${percent}%"></i></div>
    <div class="construction-footnote">施工进度 ${percent}% · ${data.status === 'complete' ? `已入住 ${data.occupants.length} 人 · 夜间提供睡位` : esc(data.description)}</div>`;
}

function renderLog() {
  log.innerHTML = actions.getRecentLogs(5).map((entry) => `<li><time>${esc(entry.time.label.split(' ').at(-1))}</time><span>${esc(entry.summary)}</span></li>`).join('');
}

function render() {
  renderPeople();
  renderDetail();
  renderCamp();
  renderConstruction();
  renderLog();
  view.setSelectedPerson(selectedId);
  view.redraw();
}

peopleList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-person-id]');
  if (row) select(row.dataset.personId);
});

bus.on('people:changed', ({ person, reason }) => {
  if (reason === 'activity:set' && person.activity.current) status.textContent = `${person.identity.name}：${person.activity.current.label} · ${person.activity.current.phase}`;
  render();
});
bus.on('camp:changed', renderCamp);
bus.on('buildings:changed', () => { renderConstruction(); view.redraw(); });
bus.on('buildings:completed', ({ building }) => {
  const residents = people.getAlive().map((person) => person.id);
  buildings.assignOccupants(building.id, residents);
  residents.forEach((id) => people.setLocation(id, { homeId: building.id }));
  status.textContent = '集体草棚建成，十位村民第一次有了遮蔽之所。';
  render();
});
bus.on('actions:log', ({ entry }) => { status.textContent = entry.summary; renderLog(); });
bus.on('environment:phase', ({ phase }) => {
  status.textContent = phase.isNight ? '夜幕降临，村民正回到营地与住所。' : `${phase.label}，起始河谷正在苏醒。`;
  view.redraw();
});
bus.on('simulation:time', ({ time: stamp, phase }) => {
  clock.innerHTML = `<span class="map-overlay__dot"></span>${esc(phase?.label ?? '')} · ${esc(stamp.label)}`;
  view.redraw();
});
bus.on('map:changed', ({ map: nextMap }) => { view.setMap(nextMap); view.redraw(); });

window.shengling = Object.freeze({ peopleSystem: people, mapSystem: map, campStore: camp, buildingSystem: buildings, actionSystem: actions, gameTime: time, mapView: view });
render();
actions.start();
