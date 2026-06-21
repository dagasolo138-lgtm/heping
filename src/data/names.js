export const SURNAME_POOL = Object.freeze(['陈', '高', '林', '石', '许', '周', '唐', '韩', '苏', '沈', '顾', '陆']);
export const GIVEN_NAME_POOL = Object.freeze(['禾', '远', '野', '澜', '川', '宁', '临', '果', '岳', '青', '砚', '岚', '舟', '雨']);

export function makeDisplayName(index = 0) {
  return `${SURNAME_POOL[index % SURNAME_POOL.length]}${GIVEN_NAME_POOL[index % GIVEN_NAME_POOL.length]}`;
}
