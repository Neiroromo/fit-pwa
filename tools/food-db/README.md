# Сборка встроенной базы продуктов

Файлы `modules/nutrition/data/base.bin` и `ru.bin` собираются из открытых данных. Скрипты запускаются вручную (например, раз в квартал); результат лежит в репозитории.

1. **USDA** — скачайте с https://fdc.nal.usda.gov/download-datasets/ наборы *Foundation Foods* (JSON) и *SR Legacy* (CSV), распакуйте в две отдельные папки, затем:
   `node tools/food-db/usda.mjs <папка Foundation> <папка SR Legacy> <рабочая папка>/usda.json`
2. **Перевод и отбор** — названия переводятся на русский через Gemini (ключ `GEMINI_API_KEY` в `.env.local`, наружу уходят только названия продуктов); продукты, неинтересные российскому пользователю (бренды, экзотика, детское питание), отбрасываются:
   `node tools/food-db/translate.mjs <рабочая папка>/usda.json <рабочая папка>/tr --parallel 2 --batch 100`
   Скрипт можно прерывать и запускать снова: готовые порции пропускаются. Результат — `<рабочая папка>/tr/base-ru.json`.
3. **Open Food Facts** — скачайте `en.openfoodfacts.org.products.csv.gz` (~1,5 ГБ) с https://world.openfoodfacts.org/data и выберите российские товары (самые популярные, с названием и сходящимися КБЖУ):
   `node tools/food-db/off.mjs <файл .csv.gz> <рабочая папка>/off-ru.json --top 15000`
4. **Упаковка**: `node tools/food-db/build.mjs <рабочая папка>/tr/base-ru.json <рабочая папка>/off-ru.json` — создаёт `data/base.bin`, `data/ru.bin` и `data/SOURCES.md`.

Лицензии: USDA FoodData Central — общественное достояние (CC0); Open Food Facts — ODbL 1.0 (база) и DbCL 1.0 (содержимое): производная база остаётся открытой, ссылка на источник обязательна (она есть в приложении и в `data/SOURCES.md`).
