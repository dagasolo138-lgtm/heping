export function createFounders(peopleSystem) {
  const specs = [
    { name: '陈禾', gender: 'female', age: 28, occupation: 'gatherer', traits: ['curious', 'generous'], skills: { gathering: 7, cooking: 4, social: 5 }, preferences: ['采集', '照看营地'] },
    { name: '高远', gender: 'male', age: 31, occupation: 'woodcutter', traits: ['diligent', 'calm'], skills: { woodcutting: 8, building: 4, fighting: 3 }, preferences: ['伐木', '搬运'] },
    { name: '林野', gender: 'male', age: 23, occupation: 'fisher', traits: ['lively', 'brave'], skills: { fishing: 7, gathering: 4, fighting: 4 }, preferences: ['捕鱼', '探索河岸'] },
    { name: '林澜', gender: 'female', age: 20, occupation: 'cook', traits: ['patient', 'curious'], skills: { cooking: 7, gathering: 3, social: 6 }, preferences: ['烹饪', '整理物资'] },
    { name: '石川', gender: 'male', age: 35, occupation: 'stoneworker', traits: ['stubborn', 'diligent'], skills: { stoneworking: 8, crafting: 5, building: 3 }, preferences: ['采石', '制作石器'] },
    { name: '许宁', gender: 'female', age: 26, occupation: 'gatherer', traits: ['cautious', 'generous'], skills: { gathering: 6, social: 7, cooking: 3 }, preferences: ['采集', '照看伤病'] },
    { name: '周临', gender: 'male', age: 29, occupation: 'builder', traits: ['patient', 'frugal'], skills: { building: 8, crafting: 5, woodcutting: 3 }, preferences: ['建造', '修缮'] },
    { name: '唐果', gender: 'female', age: 19, occupation: 'fisher', traits: ['lively', 'curious'], skills: { fishing: 6, gathering: 5, social: 4 }, preferences: ['捕鱼', '探索'] },
    { name: '韩岳', gender: 'male', age: 38, occupation: 'woodcutter', traits: ['brave', 'calm'], skills: { woodcutting: 6, fighting: 7, building: 3 }, preferences: ['守夜', '伐木'] },
    { name: '苏青', gender: 'female', age: 33, occupation: 'trader', traits: ['frugal', 'calm'], skills: { trading: 7, cooking: 5, social: 6 }, preferences: ['清点物资', '协调分配'] },
  ];

  const people = specs.map((spec, index) => peopleSystem.create({
    identity: {
      name: spec.name,
      gender: spec.gender,
      portraitSeed: `founder-${index + 1}-${spec.name}`,
      birth: { year: 1 - spec.age, day: 1 + ((index * 31) % 300) },
    },
    work: { occupation: spec.occupation, skills: spec.skills, preferences: spec.preferences },
    traits: spec.traits,
    state: { hunger: 18 + (index % 4) * 4, thirst: 16 + (index % 3) * 5, energy: 74 + (index % 4) * 5, health: 92 + (index % 3) * 3, mood: index % 2 === 0 ? 4 : -2, stress: 12 + (index % 4) * 4 },
    inventory: { items: index % 2 ? { berries: 1 } : { wood: 1 }, equipment: {}, ownedResources: {}, claims: [] },
  }));

  peopleSystem.connect(people[0].id, people[1].id, 'spouse');
  peopleSystem.connect(people[2].id, people[3].id, 'sibling');
  peopleSystem.connect(people[5].id, people[6].id, 'spouse');

  people.forEach((person, index) => {
    peopleSystem.addLifeEvent(person.id, {
      type: 'settlement',
      summary: `${person.identity.name} 与其余九人抵达起始河谷，准备建立新的聚落。`,
      details: { settlement: 'starting-valley', founderIndex: index + 1 },
    });
  });

  return peopleSystem.list({ sortBy: 'birth' });
}
