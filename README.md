# Домашняя работа 2 — MongoDB

## Раздел 2. Данные и запросы

Все команды ниже повторяют операции из `solution.js`: `installValidator`, `searchProducts`, `historyCursor` и `history`. Перед опытом контрольный набор восстанавливается командой `reset`.

### 2.1. Валидатор коллекции `products`

**Команда — установка валидатора.**

```sh
docker compose run --rm lab reset
docker compose run --rm lab shell
```

В открытой оболочке задаём `c` и выполняем тот же `collMod`, что и `installValidator` в `solution.js`:

```javascript
const c = db.getSiblingDB("hw2")
await c.runCommand({
  collMod: "products",
  validator: {
    $and: [
      {$jsonSchema: {
        bsonType: "object",
        required: ["_id", "name", "category", "price", "variants"],
        properties: {
          _id: {bsonType: "string"},
          name: {bsonType: "string"},
          category: {bsonType: "string"},
          price: {bsonType: "decimal", minimum: 0},
          variants: {
            bsonType: "array",
            items: {
              bsonType: "object",
              required: ["size", "stock"],
              properties: {
                size: {bsonType: "string"},
                stock: {bsonType: ["int", "long"], minimum: 0}
              }
            }
          }
        }
      }},
      {$expr: {$eq: [
        {$size: "$variants"},
        {$size: {$setUnion: [{$map: {
          input: "$variants", as: "variant", in: "$$variant.size"
        }}]}}
      ]}}
    ]
  },
  validationLevel: "strict",
  validationAction: "error"
})
```

**Результат:** команда возвращает `ok: 1`, после чего коллекция работает в режиме `strict/error`.

**Результат.**

```text
PASS validator strict/error installed
```

**Команда — проверка документов.** В `solution.js` для каждого случая выполняется `products.insertOne`; ниже приведены те же три вставки на базе товара `A`.

```javascript
const product = await c.products.findOne({_id: "A"})
await c.products.insertOne({...product, _id: "valid"})
try { await c.products.insertOne({...product, _id: "string-price", price: "100.00"}) }
catch (e) { printjson({id: "string-price", code: e.code, details: e.errInfo}) }
try { await c.products.insertOne({...product, _id: "negative-stock",
  variants: [{size: "L", stock: NumberInt(-1)}]}) }
catch (e) { printjson({id: "negative-stock", code: e.code, details: e.errInfo}) }
```

**Результат.**

| Документ | Результат вставки | Код MongoDB | Причина отказа |
|---|---|---:|---|
| `valid` | принят | 0 | документ соответствует схеме |
| `string-price` | отклонён | 121 | `price` имеет тип `string`, требуется `decimal` |
| `negative-stock` | отклонён | 121 | `variants[0].stock` меньше минимального значения 0 |

Оба отказа пришли от валидатора MongoDB, а не от проверки в приложении.

### 2.2. Поиск товаров

В `solution.js` поиск использует один `$elemMatch`, поэтому `size` и `stock` относятся к одному элементу `variants`, затем сортирует полные документы по `_id`.

**Команда — контрольный контрпример `clothes/L/2`.**

```javascript
await c.products.find({
  category: "clothes",
  variants: {$elemMatch: {size: "L", stock: {$gte: 2}}}
}).sort({_id: 1}).toArray()
```

**Результат до изменения остатка:** `B`, `C`. Товар `A` не найден: у `A/L` остаток `0`, хотя у `A/M` остаток `10`.

Фактический вывод запроса (полные документы):

```text
[
  { _id: "B", name: "Рубашка", category: "clothes", price: Decimal128("80.00"),
    variants: [{size: "L", stock: 5}, {size: "M", stock: 4}] },
  { _id: "C", name: "Толстовка", category: "clothes", price: Decimal128("90.00"),
    variants: [{size: "L", stock: 3}, {size: "M", stock: 2}] }
]
```

**Команда — остальные входы из сценария `data`.**

```javascript
c.products.find({category: "clothes", variants: {$elemMatch: {size: "M", stock: {$gte: 5}}}})
  .sort({_id: 1}).toArray()
c.products.find({category: "accessories", variants: {$elemMatch: {size: "L", stock: {$gte: 3}}}})
  .sort({_id: 1}).toArray()
c.products.find({category: "clothes", variants: {$elemMatch: {size: "L", stock: {$gte: 99}}}})
  .sort({_id: 1}).toArray()
```

**Результат:**

| Вход | Найденные `_id` |
|---|---|
| `clothes/M/5` | `A` |
| `accessories/L/3` | `D` |
| `clothes/L/99` | `[]` |

Фактический вывод полных документов:

```text
clothes/M/5 -> [
  {
    _id: "A",
    name: "Футболка",
    category: "clothes",
    price: Decimal128("100.00"),
    variants: [{size: "L", stock: 0}, {size: "M", stock: 10}]
  }
]

accessories/L/3 -> [
  {
    _id: "D",
    name: "Ремень",
    category: "accessories",
    price: Decimal128("120.00"),
    variants: [{size: "L", stock: 4}, {size: "M", stock: 6}]
  }
]

clothes/L/99 -> []
```

**Команда — изменение остатка и повторный поиск.**

```javascript
await c.products.updateOne(
  {_id: "A", "variants.size": "L"},
  {$set: {"variants.$.stock": NumberInt(2)}}
)
await c.products.find({
  category: "clothes",
  variants: {$elemMatch: {size: "L", stock: {$gte: 2}}}
}).sort({_id: 1}).toArray()
```

**Результат после изменения:** `A`, `B`, `C`. Возвращаются полные документы товаров со всеми вариантами, а не только идентификаторы.

Фактический вывод полных документов:

```text
[
  {
    _id: "A",
    name: "Футболка",
    category: "clothes",
    price: Decimal128("100.00"),
    variants: [{size: "L", stock: 2}, {size: "M", stock: 10}]
  },
  {
    _id: "B",
    name: "Рубашка",
    category: "clothes",
    price: Decimal128("80.00"),
    variants: [{size: "L", stock: 5}, {size: "M", stock: 4}]
  },
  {
    _id: "C",
    name: "Толстовка",
    category: "clothes",
    price: Decimal128("90.00"),
    variants: [{size: "L", stock: 3}, {size: "M", stock: 2}]
  }
]
```

### 2.3. История заказов

В `solution.js` функция `historyCursor` выполняет фильтр по `userId` и `status`, сортировку `{createdAt: -1, _id: 1}` и ограничение `.limit(20)`.

**Команда — контрольная история.**

```javascript
await c.orders.find({userId: 2500, status: "paid"})
  .sort({createdAt: -1, _id: 1})
  .limit(20)
  .toArray()
```

**Результат:** 20 полных документов в порядке:

```text
H24, H25, H22, H23, H20, H21, H18, H19, H16, H17,
H14, H15, H12, H13, H10, H11, H08, H09, H06, H07
```

Полные документы также сохраняются сценарием `data` в `results/results.json`.

При одинаковом `createdAt` сначала идут меньшие `_id` (`H24` перед `H25` и т. д.). Ограничение в 20 документов соблюдено.

**Команды — дополнительные случаи.**

```javascript
await c.orders.find({userId: 2501, status: "paid"})
  .sort({createdAt: -1, _id: 1}).limit(20).toArray()

await c.orders.find({userId: 2500, status: "cancelled"})
  .sort({createdAt: -1, _id: 1}).limit(20).toArray()

await c.orders.find({userId: 9999, status: "paid"})
  .sort({createdAt: -1, _id: 1}).limit(20).toArray()
```

**Результат:** для пользователя `2501` возвращается `other-user`; для `2500` со статусом `cancelled` — `other-status`, `excluded-cancelled`; для `9999` — `[]`.

Фактический вывод:

```text
userId=2501, status=paid       -> [ "other-user" ]
userId=2500, status=cancelled  -> [ "other-status", "excluded-cancelled" ]
userId=9999, status=paid       -> []
```

### 2.4. Ответы на вопросы о модели данных

**Почему позиции встроены в заказ?** Позиции — часть конкретной покупки, поэтому их удобно хранить внутри документа заказа. При чтении заказа мы сразу получаем его полный состав и не выполняем каждый раз объединение `orders` с `products` через `$lookup` только ради SKU, размера и количества. Встроенная структура также сохраняет состав заказа как единое целое: изменение каталога не переписывает уже оформленный заказ.

**Почему история покупателя хранится отдельными документами?** Заказ является самостоятельным событием со своей датой, статусом и составом. Отдельные документы позволяют быстро отбирать историю по `userId` и `status`, сортировать её по дате, ограничивать выдачу двадцатью последними заказами и строить индекс под этот запрос. Хранение всех заказов в одном массиве пользователя усложнило бы такие запросы и привело бы к постоянному росту одного документа, размер которого ограничен.

**Какой факт представляет `items[].price`?** Это фактическая цена одной единицы товара в момент оформления заказа, а не ссылка на текущую цену каталога. Например, если товар был куплен за `100.00`, а позже его `products.price` изменили на `999.00`, в заказе должна остаться `100.00`. Благодаря этому история заказов и отчёт о выручке не меняются задним числом.

## Раздел 3. Отчёт о продажах

**Команда — итоговый прогон сценария отчёта.**

```sh
docker compose run --rm lab reset
docker compose run --rm lab data
```

В `solution.js` отчёт строится aggregation pipeline: `$match` по `status` и периоду `[from, to)`, `$unwind` позиций, расчёт `qty × items.price`, `$group`, `$lookup` каталога, сортировка и `$limit: 5`.

**Фактический вывод для `[2026-01-01, 2026-02-01)`, `paid`:**

```text
[
  { sku: "A", name: "Футболка", qty: 3, revenue: "320.00" },
  { sku: "B", name: "Рубашка", qty: 4, revenue: "320.00" },
  { sku: "C", name: "Толстовка", qty: 3, revenue: "270.00" },
  { sku: "D", name: "Ремень", qty: 2, revenue: "240.00" },
  { sku: "E", name: "Сумка", qty: 1, revenue: "200.00" }
]
```

**Команда — граничный и пустой периоды.**

```javascript
await report(c, ISODate("2026-01-01T00:00:00Z"), ISODate("2026-01-01T00:00:00.001Z"))
await report(c, ISODate("2024-01-01T00:00:00Z"), ISODate("2024-02-01T00:00:00Z"))
```

**Фактический вывод:** на нижней границе возвращаются `B` (`qty: 4`, `320.00`) и `A` (`qty: 2`, `200.00`); пустой период возвращает `[]`.

**Команда — изменение текущей цены каталога.**

```javascript
await c.products.updateOne({_id: "A"}, {$set: {price: NumberDecimal("999.00")}})
await report(c, ISODate("2026-01-01T00:00:00Z"), ISODate("2026-02-01T00:00:00Z"))
```

**Фактический вывод:** строка для `A` остаётся `{sku: "A", qty: 3, revenue: "320.00"}`. Изменение `products.price` не влияет на отчёт, потому что расчёт использует историческую `items.price`.

### Ответы на вопросы раздела 3

- **Какие заказы попадают в отчёт?** Только заказы со статусом `paid` и датой в полуинтервале `[from, to)`: нижняя граница включается, верхняя исключается. Неоплаченные заказы и заказы вне периода не участвуют.
- **Как рассчитываются количество и выручка?** После `$unwind` позиции группируются по SKU. Для каждой позиции вычисляется `items.qty × items.price`, затем количества и суммы складываются. Для товара `A`: `2 × 100.00 + 1 × 120.00 = 320.00`, количество `2 + 1 = 3`.
- **Зачем нужен `$lookup`?** Он добавляет название товара из `products`, а итоговая сортировка идёт по выручке по убыванию, затем по SKU по возрастанию; `$limit: 5` оставляет топ-5.
- **Почему изменение цены каталога не меняет отчёт?** `items.price` — цена фактической продажи в заказе. Поэтому после изменения текущей `products.price` на `999.00` выручка `A` остаётся `320.00`.

## Раздел 4. Индекс и план выполнения

**Команды:**

```sh
docker compose run --rm lab reset index
docker compose run --rm lab index
```

Сценарий использует тот же запрос, что и `historyCursor` в `solution.js`:

```javascript
c.orders.find({userId: 2500, status: "paid"})
  .sort({createdAt: -1, _id: 1}).limit(20)
```

И создаёт `historyIndex`:

```javascript
{userId: 1, status: 1, createdAt: -1, _id: 1}
```

**Фактический вывод:**

| Вариант | nReturned | totalKeysExamined | totalDocsExamined | Отдельная `SORT` |
|---|---:|---:|---:|---|
| До индекса | 20 | 0 | 10000 | Да |
| После индекса | 20 | 20 | 20 | Нет |

```text
PASS same IDs and order
PASS before scans collection + SORT
PASS after uses IXSCAN without SORT
PASS examines fewer documents
hint: false
```

### Ответы на вопросы раздела 4

- **Какой индекс создан и почему в таком порядке?** `{userId: 1, status: 1, createdAt: -1, _id: 1}`. Сначала идут поля точного фильтра, затем поля сортировки и их направления. Это соответствует правилу ESR и позволяет сразу читать результат в нужном порядке.
- **Что изменилось в плане?** До индекса выполняются `COLLSCAN` и отдельная `SORT`: проверены 10 000 документов. После индекса используется `IXSCAN`, проверены 20 ключей и 20 документов, отдельной сортировки нет.
- **Изменилась ли выдача?** Нет. Список из 20 `_id` и его порядок совпали до и после создания индекса.
- **Применялся ли `hint`?** Нет, `hint: false`; планировщик сам выбрал составной индекс.
- **Какова издержка индекса?** Он занимает место и память и требует дополнительной работы при вставке, изменении или удалении заказа.

## Раздел 5. Транзакционная покупка

**Команда:**

```sh
docker compose run --rm lab reset
docker compose run --rm lab purchase
```

Операция из `solution.js` использует одну сессию и транзакцию с `readConcern: {level: "snapshot"}`, `readPreference: "primary"`, `writeConcern: {w: "majority", j: true}`. Каждое списание содержит `$elemMatch` с проверкой `stock: {$gte: qty}`.

**Фактический вывод отката после отказа второго товара:**

```text
TX { event: "update_inside_transaction", sku: "A", matched: 1, modified: 1 }
TX { event: "update_inside_transaction", sku: "B", matched: 0, modified: 0 }
PASS second item insufficient
PASS first update modified before abort
PASS server observed started and aborted transaction
PASS abort restores both full documents and leaves no order

AFTER ABORT
stocks: A/L=0, A/M=10, B/L=5, B/M=4
orderCount: 0
orderIds: []
```

То есть первое изменение реально выполняется внутри транзакции, но после `abortTransaction()` остатки возвращаются к исходным, а заказ отсутствует.

**Фактический вывод успешной покупки:**

```text
TX { event: "update_inside_transaction", sku: "A", matched: 1, modified: 1 }
TX { event: "update_inside_transaction", sku: "B", matched: 1, modified: 1 }
PASS server observed started and committed transaction
PASS exactly one created order

SAVED ORDER
{
  _id: "purchase-001",
  userId: 2500,
  status: "created",
  items: [
    {sku: "A", size: "M", qty: 2, price: Decimal128("100.00")},
    {sku: "B", size: "L", qty: 1, price: Decimal128("80.00")}
  ]
}
```

После `commit` остатки равны `A/M=8` и `B/L=4`; создан ровно один заказ `purchase-001`.

**Фактический вывод повтора и конфликта:**

```text
PASS replay returns original order
PASS replay no writes despite changed catalog price/key order
PASS changed qty rejected as request conflict
PASS conflict changes nothing
```

### Ответы на вопросы раздела 5

- **Чем атомарность отличается от защиты от повтора?** Атомарность гарантирует, что два списания и создание заказа выполняются как одно изменение: после ошибки откатывается всё. Защита от повтора проверяет уже существующий `operationId` и не допускает повторного списания для того же бизнес-запроса.
- **Как выполняется успешная покупка?** В одной сессии открывается транзакция со `snapshot`, чтением с `primary` и записью `majority` с `j: true`. После двух успешных условных обновлений и вставки заказа вызывается `commitTransaction()`.
- **Как выполняется откат?** Условие каждого `updateOne` содержит размер и `stock: {$gte: qty}`. Если второе обновление не находит достаточного остатка, выбрасывается `ITEM_UNAVAILABLE`, вызывается `abortTransaction()`, и первое списание исчезает вместе с остальными изменениями.
- **Как работает повтор и конфликт?** Совпадающие `userId`, `sku`, `size`, `qty` возвращают сохранённый заказ без новых записей. Изменённый параметр даёт `REQUEST_CONFLICT`; база не изменяется. Текущая цена каталога при сравнении не используется.
- **Что подтверждают счётчики транзакций?** Для успешной покупки наблюдаются запуск и commit, для опыта с нехваткой второго товара — запуск и abort. Это дополняет проверку остатков и отсутствия заказа после отката.

## Раздел 6. Смена primary

**Команда:**

```sh
docker compose run --rm lab failover
```

Клиент использует seed list из `m1`, `m2`, `m3` и `replicaSet=hw2rs`, поэтому получает актуальную топологию и после выборов находит новый primary сам.

**Фактический вывод ролей и операций:**

```text
ROLES BEFORE
m1:27017 SECONDARY
m2:27017 PRIMARY
m3:27017 SECONDARY

FIRST WRITE
{ acknowledged: true, insertedId: "before" }

ROLES AFTER
m1:27017 PRIMARY
m2:27017 SECONDARY
m3:27017 SECONDARY

READ OLD DOCUMENT
{ _id: "before", message: "majority confirmed before stepDown" }

NEW WRITE
{ acknowledged: true, insertedId: "after" }

PASS same client instance
PASS old majority document read
PASS new majority write acknowledged
PASS both documents present
```

### Ответы на вопросы раздела 6

- **Как клиент находит новый primary?** URI содержит адреса всех трёх узлов и `replicaSet=hw2rs`. Драйвер получает от replica set сведения о ролях, замечает смену primary и тем же клиентом выбирает новый узел. Адрес подключения вручную не меняется.
- **Что гарантирует `w: "majority", j: true`?** Запись подтверждена большинством узлов и зафиксирована на диске. Поэтому контрольный документ переживает смену primary.
- **Почему majority не гарантирует немедленное чтение с любой secondary?** Secondary может ещё не применить соответствующую запись из oplog. Для актуального чтения следует читать с primary либо использовать подходящий `readConcern`/causal consistency.

## Раздел 7. Шардирование

### Ответы на вопросы раздела 7

- **Какие шарды опросит история `{userId: 2500}`?** Только шард B: `2500` попадает в диапазон `2000 <= userId < 5000`, а shard key `{userId: 1}` позволяет выполнить точную маршрутизацию.
- **Какие шарды опросит общий отчёт `{status: "paid"}`?** Оба шарда, A и B. В запросе нет условия по `userId`, поэтому `mongos` не может выбрать один диапазон и выполняет scatter-gather.
- **Изменится ли число участников после индекса `{status: 1}`?** Нет. Число участников определяется shard key, а локальный индекс не влияет на маршрутизацию. Индекс может изменить только работу на уже выбранных шардах: например, заменить полный просмотр локальной коллекции индексным поиском оплаченных заказов.
