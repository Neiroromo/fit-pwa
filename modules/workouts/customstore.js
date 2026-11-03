// Свои упражнения пользователя (коллекция exercises модуля). Форма карточки такая же, как у каталога:
//   {id:'cx:…', custom:true, n, g:[группы], e:[оборудование], m:[основные мышцы], s:[дополнительные], l, h, d:[шаги техники], img:[data-URL]}
// Теги — произвольные строки: новые теги сразу попадают в фильтры каталога.

let list = [];

export const customExercises = () => list;

export async function refreshCustom(ctx) {
  list = await ctx.db.collection('exercises').list();
  return list;
}

export async function saveCustom(ctx, ex) {
  const saved = await ctx.db.collection('exercises').put({ ...ex, custom: true, id: ex.id ?? 'cx:' + ctx.ui.uid() });
  await refreshCustom(ctx);
  return saved;
}

export async function removeCustom(ctx, id) {
  await ctx.db.collection('exercises').remove(id);
  await refreshCustom(ctx);
}
