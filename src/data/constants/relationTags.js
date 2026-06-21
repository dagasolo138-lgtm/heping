export const RELATION_TAGS = Object.freeze([
  'stranger', 'acquaintance', 'friend', 'rival', 'enemy',
  'family', 'spouse', 'sibling', 'parent', 'child', 'mentor', 'debtor',
]);

export const RELATION_LABELS = Object.freeze({
  stranger: '陌生', acquaintance: '熟人', friend: '朋友', rival: '竞争者',
  enemy: '敌对', family: '家人', spouse: '伴侣', sibling: '手足',
  parent: '父母', child: '子女', mentor: '师徒', debtor: '债务往来',
});

export function relationLabel(key) {
  return RELATION_LABELS[key] ?? key;
}
