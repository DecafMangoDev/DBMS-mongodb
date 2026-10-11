// Заполняйте TODO. c — переданная база; функции выполняют реальные запросы MongoDB.
// Служебный lab.js менять не требуется. Контракты и порядок опытов — в Задание.md.
globalThis.installValidator = async c => {
    c.runCommand({
        collMod: "products",
        validator: {
            $jsonSchema: {
                bsonType: "object",
                properties: {
                    "_id": {bsonType: "string"},
                    "name": {bsonType: "string"},
                    "category": {bsonType: "string"},
                    "price": {bsonType: "decimal", minimum: 0},
                    "variants": {
                        bsonType: "array",
                        items: {
                            bsonType: "object",
                            properties: {
                                size: {bsonType: "string"},
                                stock: {bsonType: "int", minimum: 0}
                            }
                        }
                    }
                }
            }
        }
    })
};

// Возврат: Promise массива полных Product; порядок _id ASC; [] при отсутствии.
globalThis.searchProducts = async (c, {category, size, qty}) => {
    return c.products.find({
        category: category,
        variants: {
            $elemMatch: {
                size: size,
                stock: {
                    $gte: qty
                }
            }
        }
    })
        .sort({"_id": 1})
        .toArray()
};

// Технический helper: верните MongoDB cursor с фильтром, сортировкой и limit.
// Один и тот же запрос используется для результата и explain в опыте с индексом.
globalThis.historyCursor = (c, {userId, status}) => {
    return c.orders.find({
        userId: userId,
        status: status,
    })
        .sort({
            createdAt: -1,
            "_id": 1
        })
        .limit(20)
};
globalThis.history = async (c, input) => historyCursor(c, input).toArray();

// Заполните порядок полей и направления индекса для historyCursor.
globalThis.historyIndex = null;
// Если добавили hint в historyCursor, измените флаг на true.
globalThis.usesHistoryHint = false;

// Возврат: Promise массива {sku, name, qty, revenue}; revenue — Decimal128.
globalThis.report = async (c, from, to) => {
    return c.orders.aggregate(
        {$match: {status: "paid", createdAt: {$gte: from, $lt: to}}},
        {$unwind: {path: "$items"}},
        {$set: {revenue: {$multiply: ["$items.qty", "$items.price"]}}},
        {$group: {_id: "$items.sku", revenue: {$sum: "$revenue"}, qty: {$sum: "$items.qty"}}},
        {$lookup: {from: "products", localField: "_id", foreignField: "_id", as: "product"}},
        {$project: {_id: 0, sku: "$_id", name: { $first: "$product.name" }, qty: 1, revenue: 1}},
        {$sort: {revenue: -1, sku: 1}},
        {$limit: 5}
    )
        .toArray()
};

// request: {operationId, userId, items:[{sku,size,qty},{sku,size,qty}]}.
// Входы соответствуют контракту задания. Два SKU различны; порядок items значим.
// Возврат: Promise созданного или ранее сохранённого Order.
// При отказе: throw HWError('ITEM_UNAVAILABLE') или HWError('REQUEST_CONFLICT').
// Сообщение ошибки свободное; сценарий проверяет только error.code.
// transaction(body) предоставлена: body получает c — базу в активной сессии.
// Все операции покупки внутри body выполняйте через этот c.
globalThis.purchase = async (request, trace = () => {
}) => {
    return transaction(async c => {
        // После попытки каждого списания передавайте trace:
        // {event:'update_inside_transaction', sku, matched:r.matchedCount,
        //  modified:r.modifiedCount}, где r — настоящий результат updateOne.
        // Это позволяет показать первое успешное изменение перед abort.
        throw new Error('TODO: purchase');
    });
};

// Используйте именно переданный c: он связан с одним MongoDB-клиентом опыта.
// writeProbe: сохранить {_id:id, message} в c.probe с majority и j:true.
// Возврат — результат записи с acknowledged:true. Повтор вызова с тем же id
// должен быть безопасен: оболочка опыта может повторить запись после ошибки связи.
globalThis.writeProbe = async (c, id, message) => {
    throw new Error('TODO: writeProbe');
};
// Возврат — документ c.probe с указанным _id либо null.
globalThis.readProbe = async (c, id) => {
    throw new Error('TODO: readProbe');
};

