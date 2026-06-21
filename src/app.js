import { createEventBus } from './core/events/eventBus.js';
import { createGameTime } from './core/time/gameTime.js';
import { createPeopleSystem } from './modules/people/peopleSystem.js';
import { createFounders } from './modules/people/createFounders.js';
import { occupationLabel } from './data/constants/occupations.js';
import { traitLabel } from './data/constants/traits.js';
import { relationLabel } from './data/constants/relationTags.js';
import { SKILL_LABELS } from './data/constants/skills.js';
import { getAge } from './modules/people/personLifecycle.js';

const eventBus = createEventBus();
const gameTime = createGameTime({ year: 1, day: 1 });
const peopleSystem = createPeopleSystem({ eventBus, gameTime });
createFounders(peopleSystem);

const peopleListEl = document.querySelector('#people-list');
const personDetailEl = document.querySelector('#person-detail');
const countEl = document.querySelector('#people-count');
const systemStatusEl = document.querySelector('#system-status');
let selectedId = peopleSystem.list()[0]?.id;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function metric(label, value, tone = '') {
  return `<div class="metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
}

function listText(items, fallback = '无') {
  return items.length ? items.join('、') : fallback;
}

function renderList() {
  const people = peopleSystem.list({ sortBy: 'birth' });
  countEl.textContent = people.length;
  peopleListEl.innerHTML = people.map((person) => {
    const active = person.id === selectedId ? 'is-active' : '';
    const age = getAge(person, gameTime.now());
    return `<button class="person-row ${active}" data-person-id="${person.id}">
      <span class="portrait portrait--small" data-seed="${escapeHtml(person.identity.portraitSeed)}">${escapeHtml(person.identity.name.slice(-1))}</span>
      <span class="person-row__copy"><strong>${escapeHtml(person.identity.name)}</strong><small>${age} 岁 · ${occupationLabel(person.work.occupation)}</small></span>
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
  const events = person.memories.lifeEvents.slice(-4).reverse();
  const age = getAge(person, gameTime.now());

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

    <div class="metrics-grid">
      ${metric('饥饿', `${Math.round(person.state.hunger)} / 100`, person.state.hunger > 70 ? 'metric--warn' : '')}
      ${metric('口渴', `${Math.round(person.state.thirst)} / 100`, person.state.thirst > 70 ? 'metric--warn' : '')}
      ${metric('精力', `${Math.round(person.state.energy)} / 100`)}
      ${metric('健康', `${Math.round(person.state.health)} / 100`, person.state.health < 40 ? 'metric--danger' : '')}
      ${metric('心情', person.state.mood > 0 ? `+${person.state.mood}` : person.state.mood)}
      ${metric('压力', `${Math.round(person.state.stress)} / 100`)}
    </div>

    <div class="detail-columns">
      <section class="detail-card">
        <h3>技能倾向</h3>
        <div class="skill-list">${Object.entries(person.work.skills)
          .filter(([, value]) => value > 0)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([key, value]) => `<div><span>${escapeHtml(SKILL_LABELS[key] ?? key)}</span><b>${value}</b></div>`).join('')}</div>
        <p class="muted">偏好：${listText(person.work.preferences)}</p>
      </section>
      <section class="detail-card">
        <h3>关系与家庭</h3>
        <p>伴侣：${person.family.spouseId ? (allPeople.find((p) => p.id === person.family.spouseId)?.identity.name ?? '未知') : '无'}</p>
        <p>手足：${person.family.siblingIds.length}</p>
        <p>关系：${listText(relatedNames)}</p>
      </section>
      <section class="detail-card">
        <h3>个人库存</h3>
        <p>物品：${Object.entries(person.inventory.items).length ? Object.entries(person.inventory.items).map(([key, value]) => `${key} ×${value}`).join('、') : '空'}</p>
        <p>装备：${Object.keys(person.inventory.equipment).length || '无'}</p>
        <p>扩展模块：${Object.keys(person.extensions).length || '尚未接入'}</p>
      </section>
    </div>

    <section class="history-card">
      <div class="history-card__header"><h3>人生事实</h3><span>${person.memories.lifeEvents.length} 条</span></div>
      <ol>${events.map((event) => `<li><time>${escapeHtml(event.time.label)}</time><p>${escapeHtml(event.summary)}</p></li>`).join('')}</ol>
    </section>`;
}

function render() {
  renderList();
  renderDetail();
}

peopleListEl.addEventListener('click', (event) => {
  const row = event.target.closest('[data-person-id]');
  if (!row) return;
  selectedId = row.dataset.personId;
  render();
});

eventBus.on('people:changed', ({ person }) => {
  systemStatusEl.textContent = `${person.identity.name} 的人物记录已更新`;
  render();
});

window.shengling = Object.freeze({ peopleSystem, gameTime });
render();
