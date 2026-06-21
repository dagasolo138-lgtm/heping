import { createEventBus } from './core/events/eventBus.js';
import { createGameTime } from './core/time/gameTime.js';
import { createPeopleSystem } from './modules/people/peopleSystem.js';
import { createFounders } from './modules/people/createFounders.js';
import { createMapSystem } from './modules/map/mapSystem.js';
import { placeStartingSettlers } from './modules/map/placeStartingSettlers.js';
import { createCampStore, CAMP_ITEM_LABELS } from './modules/settlements/campStore.js';
import { createActionSystem } from './modules/actions/actionSystem.js';
import { createMapView } from './ui/map/mapView.js';
import { occupationLabel } from './data/constants/occupations.js';
import { traitLabel } from './data/constants/traits.js';
import { relationLabel } from './data/constants/relationTags.js';
import { SKILL_LABELS } from './data/constants/skills.js';
import { getAge } from './modules/people/personLifecycle.js';

const eventBus = createEventBus();
const gameTime = createGameTime({ year: 1, day: 1, minute: 480 });
const peopleSystem = createPeopleSystem({ eventBus, gameTime });
const mapSystem = createMapSystem({ eventBus, gameTime });
const campStore = createCampStore({ eventBus, gameTime });

createFounders(peopleSystem);
const startingMap = mapSystem.createStartingValley();
placeStartingSettlers({ peopleSystem, map: startingMap });
campStore.create({
  id: 'starting-camp',
  label: '起始营地',
  anchor: startingMap.spawnPoint,
  items: { wood: 3, berries: 2, water: 1 },
});

const actionSystem = createActionSystem({ peopleSystem, mapSystem, campStore, eventBus, gameTime });
const peopleListEl = document.querySelector('#people-list');
const personDetailEl = document.querySelector('#person-detail');
const countEl = document.querySelector('#people-count');
const systemStatusEl = document.querySelector('#system-status');
const mapCanvasEl = document.querySelector('#map-canvas');
const mapReadoutEl = document.querySelector('#map-readout');
const worldTimeEl = document.querySelector('#world-time');
const campResourcesEl = document.querySelector('#camp-resources');
const actionLogEl = document.querySelector('#action-log');
let selectedId = peopleSystem.list()[0]?.id;

const mapView = createMapView({
  canvas: mapCanvasEl,
  mapSystem,
  peopleSystem,
  getRenderPeople: () => actionSystem.getRenderPeople(),
  controls: [...document.querySelectorAll('[data-map-control]')],
  onPersonSelect(personId) {
    selectPerson(personId, { focusMap: false });
  },
  onReadout({ x, y, zoom }) {
    mapReadoutEl.textContent = `坐标 ${x}, ${y} · ${Math.round(zoom)} px/m`;
  },
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function metric(label, value, tone = '') {
  return `<div class="metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
}

function listText(items, fallback = '无') {
  return items.length ? items.join('、') : fallback;
}

function actionText(person) {
  return person.activity?.current?.label ?? '待命';
}

function selectPerson(personId, { focusMap = true } = {}) {
  selectedId = personId;
  const person = actionSystem.getRenderPeople().find((item) => item.id === personId) ?? peopleSystem.get(personId);
  mapView.setSelectedPerson(personId);
  if (focusMap) mapView.focusPerson(person);
  render();
}

function renderList() {
  const people = peopleSystem.list({ sortBy: 'birth' });
  countEl.textContent = people.length;
  peopleListEl.innerHTML = people.map((person) => {
    const active = person.id === selectedId ? 'is-active' : '';
    const age = getAge(person, gameTime.now());
    return `<button class="person-row ${active}" data-person-id="${person.id}">
      <span class="portrait portrait--small" data-seed="${escapeHtml(person.identity.portraitSeed)}">${escapeHtml(person.identity.name.slice(-1))}</span>
      <span class="person-row__copy"><strong>${escapeHtml(person.identity.name)}</strong><small>${age} 岁 · ${occupationLabel(person.work.occupation)} · ${actionText(person)}</small></span>
      <span class="person-row__health">${Math.round(person.state.health)}</span>
    </button>`;
  }).join('');
}

function renderDetail() {
  const person = peopleSystem.get(selectedId);
  if (!person) {
    personDetailEl.innerHTML = '<p>请选择一位村民。</p>';
    return;
  }
  const allPeople = peopleSystem.list();
  const relatedNames = Object.values(person.relations)
    .map((relation) => {
      const other = allPeople.find((item) => item.id === relation.personId);
      return other ? `${other.identity.name}（${relation.tags.map(relationLabel).join('/')}）` : null;
    })
    .filter(Boolean);
  const events = person.memories.lifeEvents.slice(-5).reverse();
  const age = getAge(person, gameTime.now());
  const runtimePerson = actionSystem.getRenderPeople().find((item) => item.id === person.id) ?? person;
  const position = runtimePerson.location.tileX === null ? '尚未定位' : `${runtimePerson.location.tileX.toFixed(1)}m, ${runtimePerson.location.tileY.toFixed(1)}m`;
  const action = person.activity.current;

  personDetailEl.innerHTML = `
    <div class="person-hero">
      <div class="portrait portrait--large" data-seed="${escapeHtml(person.identity.portraitSeed)}">${escapeHtml(person.identity.name.slice(-1))}</div>
      <div>
        <p class="panel__kicker">PERSON RECORD / REV ${person.revision}</p>
        <h2>${escapeHtml(person.identity.name)}</h2>
        <p class="person-hero__meta">${age} 岁 · ${occupationLabel(person.work.occupation)} · ${person.identity.alive ? '在世' : '已故'}</p>
        <div class="tag-row">${person.traits.map((trait) => `<span class="tag">${traitLabel(trait)}</span>`).join('')}</div>
      </div>
    </div>

    <div class="activity-banner ${action ? '' : 'activity-banner--idle'}">
      <span class="activity-banner__dot"></span>
      <div><small>当前行动</small><strong>${action ? `${escapeHtml(action.label)} · ${escapeHtml(action.phase)}` : '待命'}</strong></div>
    </div>

    <div class="metrics-grid">
      ${metric('饥饿', `${Math.round(person.state.hunger)} / 100`, person.state.hunger > 70 ? 'metric--warn' : '')}
      ${metric('口渴', `${Math.round(person.state.thirst)} / 100`, person.state.thirst > 70 ? 'metric--warn' : '')}
      ${metric('精力', `${Math.round(person.state.energy)} / 100`, person.state.energy < 30 ? 'metric--warn' : '')}
      ${metric('健康', `${Math.round(person.state.health)} / 100`, person.state.health < 40 ? 'metric--danger' : '')}
      ${metric('心情', person.state.mood > 0 ? `+${person.state.mood}` : person.state.mood)}
      ${metric('压力', `${Math.round(person.state.stress)} / 100`)}
    </div>

    <div class="detail-columns">
      <section class="detail-card">
        <h3>技能倾向</h3>
        <div class="skill-list">${Object.entries(person.work.skills)
          .filter(([, value]) => value > 0)
          .sort(([, first], [, second]) => second - first)
          .slice(0, 5)
          .map(([key, value]) => `<div><span>${escapeHtml(SKILL_LABELS[key] ?? key)}</span><b>${value}</b></div>`).join('')}</div>
        <p class="muted">偏好：${listText(person.work.preferences)}</p>
      </section>
      <section class="detail-card">
        <h3>空间与关系</h3>
        <p>位置：${position}</p>
        <p>伴侣：${person.family.spouseId ? (allPeople.find((item) => item.id === person.family.spouseId)?.identity.name ?? '未知') : '无'}</p>
        <p>关系：${listText(relatedNames)}</p>
      </section>
      <section class="detail-card">
        <h3>个人库存</h3>
        <p>物品：${Object.entries(person.inventory.items).length ? Object.entries(person.inventory.items).map(([key, value]) => `${CAMP_ITEM_LABELS[key] ?? key} ×${value}`).join('、') : '空'}</p>
        <p>个人记忆：${person.memories.personal.length} 条</p>
        <p>已完成行动：${person.activity.completedCount ?? 0} 次</p>
      </section>
    </div>

    <section class="history-card">
      <div class="history-card__header"><h3>人生事实</h3><span>${person.memories.lifeEvents.length} 条</span></div>
      <ol>${events.map((event) => `<li><time>${escapeHtml(event.time.label)}</time><p>${escapeHtml(event.summary)}</p></li>`).join('')}</ol>
    </section>`;
}

function renderCamp() {
  const camp = campStore.get('starting-camp');
  const items = camp?.items ?? {};
  const defaults = ['water', 'berries', 'wood'];
  campResourcesEl.innerHTML = defaults.map((itemId) => `<span class="resource-chip resource-chip--${itemId}"><b>${CAMP_ITEM_LABELS[itemId]}</b><strong>${Number(items[itemId] ?? 0)}</strong></span>`).join('');
}

function renderLog() {
  const entries = actionSystem.getRecentLogs(5);
  actionLogEl.innerHTML = entries.map((entry) => `<li><time>${escapeHtml(entry.time.label.split(' ').at(-1))}</time><span>${escapeHtml(entry.summary)}</span></li>`).join('');
}

function render() {
  renderList();
  renderDetail();
  renderCamp();
  renderLog();
  mapView.setSelectedPerson(selectedId);
}

peopleListEl.addEventListener('click', (event) => {
  const row = event.target.closest('[data-person-id]');
  if (!row) return;
  selectPerson(row.dataset.personId);
});

eventBus.on('people:changed', ({ person, reason }) => {
  if (reason === 'activity:set' && person.activity.current) systemStatusEl.textContent = `${person.identity.name}：${person.activity.current.label} · ${person.activity.current.phase}`;
  render();
});

eventBus.on('camp:changed', renderCamp);
eventBus.on('actions:log', ({ entry }) => {
  systemStatusEl.textContent = entry.summary;
  renderLog();
});
eventBus.on('simulation:time', ({ time }) => { worldTimeEl.innerHTML = `<span class="map-overlay__dot"></span>${escapeHtml(time.label)}`; });
eventBus.on('map:changed', ({ map }) => { mapView.setMap(map); mapView.redraw(); });

window.shengling = Object.freeze({ peopleSystem, mapSystem, campStore, actionSystem, gameTime, mapView });
render();
actionSystem.start();
