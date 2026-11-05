// Приблизительная оценка процента жира для мужчины по росту, весу и замерам.
//
// Три независимых метода, итог — взвешенное среднее тех, для которых хватает данных:
//   1. ВМС США (Navy): рост, талия (на уровне пупка), шея. Самый надёжный из «ленточных» — вес 0,6.
//   2. RFM (Relative Fat Mass): рост и талия: 64 − 20 × рост / талия. Вес 0,25.
//   3. ИМТ (Deurenberg, возраст по умолчанию 30): 1,2 × ИМТ + 0,23 × возраст − 16,2. Не отличает мышцы от жира — вес 0,15.
// Если доступен только ИМТ, оценка помечается как грубая. Реальная погрешность любой такой оценки около ±3–4 %.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function estimateFat({ heightCm, weightKg, waist, neck, age = 30 } = {}) {
  const parts = [];

  if (heightCm && waist && neck && waist > neck) {
    const v = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(heightCm)) - 450;
    parts.push({ id: 'navy', value: v, weight: 0.6 });
  }
  if (heightCm && waist) {
    parts.push({ id: 'rfm', value: 64 - 20 * (heightCm / waist), weight: 0.25 });
  }
  if (heightCm && weightKg) {
    const bmi = weightKg / (heightCm / 100) ** 2;
    parts.push({ id: 'bmi', value: 1.2 * bmi + 0.23 * age - 16.2, weight: 0.15 });
  }
  if (!parts.length) return null;

  const total = parts.reduce((a, p) => a + p.weight, 0);
  const value = clamp(parts.reduce((a, p) => a + p.value * p.weight, 0) / total, 3, 55);
  const quality = parts.some(p => p.id === 'navy') ? 'good' : parts.some(p => p.id === 'rfm') ? 'ok' : 'rough';
  return { value: Math.round(value * 10) / 10, quality, methods: parts.map(p => p.id) };
}
