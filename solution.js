// Заполняйте TODO. c — переданная база; функции выполняют реальные запросы MongoDB.
// Служебный lab.js менять не требуется. Контракты и порядок опытов — в Задание.md.
globalThis.installValidator = async c => {
    await c.runCommand({
        collMod: "products",
        validator: {
            $and: [
                {
                    $jsonSchema: {
                        bsonType: "object",
                        required: ["_id", "name", "category", "price", "variants"],
                        properties: {
                            "_id": {bsonType: "string"},
                            "name": {bsonType: "string"},
                            "category": {bsonType: "string"},
                            "price": {bsonType: "decimal", minimum: 0},
                            "variants": {
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
                    }
                },
                {
                    $expr: {
                        $eq: [
                            {$size: "$variants"},
                            {$size: {
                                $setUnion: [
                                    {$map: {
                                        input: "$variants",
                                        as: "variant",
                                        in: "$$variant.size"
                                    }}
                                ]
                            }}
                        ]
                    }
                }
            ]
        },
        validationLevel: "strict",
        validationAction: "error"
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
globalThis.historyIndex = {
    userId: 1,
    status: 1,
    createdAt: -1,
    _id: 1
};
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
    let expectedError;
    try {
        return await transaction(async c => {
        const sameItems = (saved, requested) => saved.length === requested.length &&
            saved.every((x, i) => {
                const y = requested[i];
                return x.sku === y.sku && x.size === y.size && Number(x.qty) === Number(y.qty);
            });

        const existing = await c.orders.findOne({_id: request.operationId});
        if (existing) {
            if (Number(existing.userId) !== Number(request.userId) || !sameItems(existing.items, request.items)) {
                expectedError = 'REQUEST_CONFLICT';
                throw HWError(expectedError);
            }
            return existing;
        }

        const orderItems = [];
        for (const requestedItem of request.items) {
            const product = await c.products.findOne({_id: requestedItem.sku});
            const variantExists = !!product && Array.isArray(product.variants) &&
                product.variants.some(v => v.size === requestedItem.size);
            if (!variantExists) {
                expectedError = 'ITEM_UNAVAILABLE';
                throw HWError(expectedError);
            }

            const result = await c.products.updateOne(
                {
                    _id: requestedItem.sku,
                    variants: {
                        $elemMatch: {
                            size: requestedItem.size,
                            stock: {$gte: requestedItem.qty}
                        }
                    }
                },
                {$inc: {"variants.$.stock": -requestedItem.qty}}
            );
            const matched = result.matchedCount ?? result.nMatched;
            const modified = result.modifiedCount ?? result.nModified;
            trace({event: 'update_inside_transaction', sku: requestedItem.sku, matched, modified});
            if (matched !== 1 || modified !== 1) {
                expectedError = 'ITEM_UNAVAILABLE';
                throw HWError(expectedError);
            }

            orderItems.push({
                sku: requestedItem.sku,
                size: requestedItem.size,
                qty: requestedItem.qty,
                price: product.price
            });
        }

        const order = {
            _id: request.operationId,
            userId: request.userId,
            createdAt: new Date(),
            status: 'created',
            items: orderItems
        };
        await c.orders.insertOne(order);
        return order;
        });
    } catch (error) {
        if (expectedError) throw HWError(expectedError);
        throw error;
    }
};

// Используйте именно переданный c: он связан с одним MongoDB-клиентом опыта.
// writeProbe: сохранить {_id:id, message} в c.probe с majority и j:true.
// Возврат — результат записи с acknowledged:true. Повтор вызова с тем же id
// должен быть безопасен: оболочка опыта может повторить запись после ошибки связи.
globalThis.writeProbe = async (c, id, message) => {
    return c.probe.updateOne(
        {_id: id},
        {$setOnInsert: {_id: id, message}},
        {upsert: true, writeConcern: {w: 'majority', j: true, wtimeout: 10000}}
    );
};
// Возврат — документ c.probe с указанным _id либо null.
globalThis.readProbe = async (c, id) => {
    let lastError;
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            return await c.probe.findOne({_id: id});
        } catch (error) {
            lastError = error;
            if (attempt < 9) await sleep(200);
        }
    }
    throw lastError;
};

