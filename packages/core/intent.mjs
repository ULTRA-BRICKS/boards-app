/** Conservative leading-command check, not a semantic entailment classifier. */
const verbs = {
  enable: ["availability", 1],
  activate: ["availability", 1],
  disable: ["availability", -1],
  deactivate: ["availability", -1],
  включить: ["availability", 1],
  активировать: ["availability", 1],
  выключить: ["availability", -1],
  отключить: ["availability", -1],
  деактивировать: ["availability", -1],
  add: ["membership", 1],
  insert: ["membership", 1],
  include: ["membership", 1],
  create: ["membership", 1],
  remove: ["membership", -1],
  delete: ["membership", -1],
  exclude: ["membership", -1],
  добавить: ["membership", 1],
  включать: ["availability", 1],
  создать: ["membership", 1],
  удалить: ["membership", -1],
  убрать: ["membership", -1],
  исключить: ["membership", -1],
  allow: ["access", 1],
  permit: ["access", 1],
  deny: ["access", -1],
  block: ["access", -1],
  разрешить: ["access", 1],
  запретить: ["access", -1],
  заблокировать: ["access", -1],
  publish: ["publication", 1],
  unpublish: ["publication", -1],
  опубликовать: ["publication", 1],
};
function action(text) {
  const words =
    String(text)
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) || [];
  while (["please", "пожалуйста", "нужно", "надо"].includes(words[0])) words.shift();
  let sign = 1;
  if (words[0] === "do" && words[1] === "not") {
    sign = -1;
    words.splice(0, 2);
  } else if (["not", "не", "don't", "don’t"].includes(words[0])) {
    sign = -1;
    words.shift();
  }
  const value = verbs[words[0]];
  return value ? [value[0], value[1] * sign] : null;
}
export function opposedActions(left, right) {
  const a = action(left),
    b = action(right);
  return !!a && !!b && a[0] === b[0] && a[1] !== b[1];
}
