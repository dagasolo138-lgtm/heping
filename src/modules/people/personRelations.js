import { RELATION_TAGS } from '../../data/constants/relationTags.js';

function clamp(value, min = -100, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function ensureRelation(person, otherId) {
  if (!person.relations[otherId]) {
    person.relations[otherId] = {
      personId: otherId,
      familiarity: 0,
      affinity: 0,
      trust: 0,
      tags: ['stranger'],
      recentMemoryIds: [],
    };
  }
  return person.relations[otherId];
}

export function adjustRelation(person, otherId, patch = {}) {
  const relation = ensureRelation(person, otherId);
  relation.familiarity = clamp(relation.familiarity + Number(patch.familiarity ?? 0));
  relation.affinity = clamp(relation.affinity + Number(patch.affinity ?? 0));
  relation.trust = clamp(relation.trust + Number(patch.trust ?? 0));
  const tags = patch.tags ?? [];
  tags.filter((tag) => RELATION_TAGS.includes(tag)).forEach((tag) => {
    if (!relation.tags.includes(tag)) relation.tags.push(tag);
  });
  if (relation.familiarity > 10) relation.tags = relation.tags.filter((tag) => tag !== 'stranger');
  if (relation.familiarity > 10 && !relation.tags.includes('acquaintance')) relation.tags.push('acquaintance');
  return relation;
}

export function linkSpouses(first, second) {
  first.family.spouseId = second.id;
  second.family.spouseId = first.id;
  adjustRelation(first, second.id, { familiarity: 100, affinity: 35, trust: 40, tags: ['family', 'spouse'] });
  adjustRelation(second, first.id, { familiarity: 100, affinity: 35, trust: 40, tags: ['family', 'spouse'] });
}

export function linkSiblings(first, second) {
  if (!first.family.siblingIds.includes(second.id)) first.family.siblingIds.push(second.id);
  if (!second.family.siblingIds.includes(first.id)) second.family.siblingIds.push(first.id);
  adjustRelation(first, second.id, { familiarity: 100, affinity: 25, trust: 30, tags: ['family', 'sibling'] });
  adjustRelation(second, first.id, { familiarity: 100, affinity: 25, trust: 30, tags: ['family', 'sibling'] });
}

export function linkParentChild(parent, child) {
  if (!parent.family.childIds.includes(child.id)) parent.family.childIds.push(child.id);
  if (!child.family.parentIds.includes(parent.id)) child.family.parentIds.push(parent.id);
  adjustRelation(parent, child.id, { familiarity: 100, affinity: 35, trust: 35, tags: ['family', 'child'] });
  adjustRelation(child, parent.id, { familiarity: 100, affinity: 35, trust: 35, tags: ['family', 'parent'] });
}
