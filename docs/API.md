# Дослідження API, 2026-09-30

Джерела: `dim9000-re/disasm.hasm` (Hermes APK), gate opener `Dim9000Api.kt` /
`AuthManager.kt`, DIM9000 1.5.0 через ADB, live GET API.

Головний сервер: https://api.dim9000.com/api/ — JSON-LD/Hydra.
Messaging: https://api-messaging.dim9000.com/api/ — JSON, NestJS CRUD.
Discovery: `GET index.jsonld`, `GET docs.jsonld` на головному сервері;
`GET https://api-messaging.dim9000.com/api/docs-json` — OpenAPI чату.

| Сутність | Читання | Запис |
|---|---|---|
| Об’єкти мешканця | GET spaces/my-spaces | поза сферою проєкту |
| Заявки | GET orders, orders/{id} | POST orders; PUT orders/{id} оголошено схемою, права потребують перевірки |
| Статуси | GET orders/{id}/transit | PATCH orders/{id}/transit {transition}; citizen_cancel лише коли повертає GET |
| Історія | GET history/order-updates?orderId={id} | тільки читання |
| Платні заявки | GET paid-orders, paid-orders/{id} | POST paid-orders, PUT paid-orders/{id}, PATCH …/transit |
| Платна історія | GET history/paid-order-updates?orderId={id} | тільки читання |
| Каталог | GET paid-order-names?complexes.id={id} | адміністрування поза сферою проєкту |
| Відгуки | вкладені review в деталях заявки; GET reviews/{id} | POST reviews {order,rating,comment}; PATCH reviews/{id}; paid-reviews аналогічно |
| Файли | gallery.files, media.files, підписані uri | POST files/order/media/upload, multipart file + originalName |
| Галереї | вкладені в деталі заявки | PATCH galleries/{id} {files:[IRI]} оголошено схемою |
| Діалог | topics за externalId або order.topicId | POST orders/chat/topic {order:IRI} |
| Повідомлення | GET messages?filter=topic.id\|\|$eq\|\|{uuid}&sort=createdAt,DESC&limit=30&page=1 | POST messages {type:"text",body,topic:uuid}; PATCH messages/{id} {body} |

Читання заявок, каталогу, діалогів і історії перевірене живими запитами.
Частина write-операцій оголошена схемами; їх виконання для мешканця не
підтверджено реальними змінами. Існування методу в схемі не гарантує права.
DELETE заявки у схемі відсутній. Видалення не є вимогою цього прототипу.

Список заявок: `page`, `itemsPerPage`, `space`, `order[createdAt]=desc`,
`status[]`, `category`, `keyword_search` (номер або текст). `search` не
знаходить заявку за номером; `id` підтримує точний номер. Hydra має `hydra:member`, `hydra:totalItems`
і `hydra:view.hydra:next`. Чат має `data`, `total`, `page`, `pageCount`.

Історія: **orderId**, а не одночасні `order=IRI` та `order[createdAt]`:
PHP перезаписує скаляр order масивом сортування й фільтр втрачається.
Журнал містить `before`, `after`, `type`, `createdBy`, `createdAt`.
Прототип додатково відсіює записи, order яких не відповідає вибраній заявці.

POST orders: `{category,description,space:"/api/apartments/...",gallery:{files:["/api/files/..."]}}`.
Використовувати точний `@id` об’єкта з my-spaces, не конструювати IRI.
POST paid-orders: `{name:"/api/paid-order-names/...",space:IRI,description}`.
PATCH головного API — application/merge-patch+json. POST/PUT — application/ld+json.

У червневому APK категорії й payload підтверджують функції #31234–31238,
#31241–31249; topics/messages #31184–31188; upload #33907.
Фото надходять у gallery; звітні файли — media; відповідь — answer;
відхилення — cancellationReason; оцінка — review.

OAuth: client_credentials → users/phone-verification → users/code-check →
grant_type=sms (username, smsCode). Оновлення grant_type=refresh_token.
Стандартний User-Agent Python urllib був відхилений Cloudflare 1010;
явний User-Agent dim9000-zayavki/1.0 працює.

## Коментарі в push-сповіщеннях

`GET notifications?page=1&itemsPerPage=100&order[createdAt]=desc` повертає
окремі ресурси `Notification` для авторизованого одержувача, зокрема
типу `order_deadline_updated`.

Для такого типу payload містить `comment`, `newDeadline`, `objectId`,
`objectStatus`, `objectCategory`, `complexName`. Вкладене `order.@id`
однозначно прив’язує запис до заявки. Коментарі й нові терміни звірено
з push-сповіщеннями. Приватні приклади й ідентифікатори не включені в репозиторій.

Події статусу мають type `order`; `payload.transition` — **JSON-рядок**
із полями `name`, `from`, `to`. Це не повідомлення чату і не `OrderUpdate`.
Автор коментаря в самому Notification не наданий, тому не приписуємо його
людині з найближчого за часом запису історії.

Hydra не оголошує фільтра за ID заявки. Сервер завантажує всі сторінки
колекції одержувача, зіставляє точний `order`/`paidOrder` і видаляє дублікати
за id. Лише коли обидва зв’язки відсутні, використовує тип і payload.objectId.
Читання не викликає `PATCH notifications/read/*` або `readAll`.
В інтерфейсі та TXT-експорті додано «Сповіщення та пояснення УК».

Поточний APK і 3 split-файли збережено в `.local/apk-2026-09-30/`.
SHA256 base.apk: `ce5816d6e9e767bb19c7a1d864c992354d17b271052c342a57cf5e0645467fe6`.
Поточний Hermes bundle декомпільовано локально в `disasm.hasm`.
Він підтверджує GET notifications з пагінацією та кешуванням списку.
У bundle немає рядків `order_deadline_updated` і `newDeadline`; тому
схему цих подій підтверджено живим API та точним збігом зі скріншотом.
Це пояснює можливу прогалину клієнтського відображення, але не доводить
конкретну причину відсутності тексту на всіх екранах мобільного застосунку.

Оцінка: сервер відхиляє створення відгуку, якщо статус не `completed`,
з помилкою `order: Order must be completed.` Форма доступна для всіх статусів,
але це не скасовує серверну валідацію.
