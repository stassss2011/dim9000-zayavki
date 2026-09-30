"""Resident-scoped operations. Never enumerate unrelated files or messages."""
import base64
import re
import uuid
from urllib.parse import urlencode

from client import ApiError
from notifications import order_notifications

CATEGORIES = dict(zip(
    'cleaning water_supply elevator heating fire_protection_system ventilation sewerage electricity repairs intercom_and_video client_service adjacent_territory protection financial_issues other'.split(),
    ['Прибирання', 'Водопостачання', 'Ліфт', 'Опалення', 'Протипожежна система', 'Вентиляція',
     'Каналізація', 'Електроенергія', 'Ремонтні роботи', 'Домофон, відео, СКД', 'Клієнт-сервіс',
     'Будинок та територія', 'Охорона', 'Фінансові питання', 'Інше']))


def iri(value):
    return value.get('@id') if isinstance(value, dict) else value


class Service:
    def __init__(self, client):
        self.client = client
        self.uploads = set()

    def spaces(self):
        return self.client.request('GET', 'spaces/my-spaces?itemsPerPage=1000')['hydra:member']

    def context(self, body):
        kind, ident = body.get('kind', 'orders'), str(body.get('id', ''))
        if kind not in ('orders', 'paid-orders') or not ident.isdigit():
            raise ValueError('Невірний номер заявки')
        path = kind + '/' + ident
        order = self.client.request('GET', path)
        if iri(order.get('space')) not in {s['@id'] for s in self.spaces()}:
            raise ApiError(403, {'message': 'Заявка не належить вашим об’єктам'})
        return path, order

    def call(self, body):
        action = body.get('action')
        c = self.client
        if action == 'bootstrap':
            return {'spaces': self.spaces(), 'categories': CATEGORIES}
        if action == 'list':
            kind = body.get('kind', 'orders')
            if kind not in ('orders', 'paid-orders'):
                raise ValueError('Невідомий тип заявок')
            spaces = self.spaces()
            selected = body.get('space') or spaces[0]['@id']
            if selected not in {s['@id'] for s in spaces}:
                raise ValueError('Оберіть ваш об’єкт')
            query = {'page': max(1, int(body.get('page', 1))), 'itemsPerPage': 20,
                     'order[createdAt]': 'desc', 'space': selected}
            for key in ('status', 'category'):
                if body.get(key):
                    query[key] = body[key]
            if body.get('search'):
                key = 'search'
                if kind == 'orders':
                    key = 'id' if re.fullmatch(r'[0-9]+', str(body['search'])) else 'keyword_search'
                query[key] = body['search']
            if body.get('group') == 'active':
                query['status[]'] = ['new', 'consideration', 'in_progress', 'not_paid', 'processing_refunds']
            elif body.get('group') == 'finished':
                query['status[]'] = ['completed', 'canceled']
            return c.request('GET', kind + '?' + urlencode(query, doseq=True))
        if action == 'catalog':
            spaces = self.spaces()
            space = next((s for s in spaces if s['@id'] == body.get('space')), spaces[0] if spaces else None)
            if not space:
                raise ValueError('Немає доступних об’єктів')
            return c.request('GET', 'paid-order-names?' + urlencode({
                'complexes.id': iri(space['complex']).rsplit('/', 1)[-1], 'itemsPerPage': 1000}))
        if action == 'upload':
            data = base64.b64decode(body.get('data', ''), validate=True)
            if not data or len(data) > 10 * 1024 * 1024:
                raise ValueError('Файл має бути від 1 байта до 10 МБ')
            name = re.sub(r'[^\w. -]', '_', str(body.get('name', 'photo.jpg')))[:150]
            mime = body.get('mime', 'image/jpeg')
            if mime not in ('image/jpeg', 'image/png', 'image/webp'):
                raise ValueError('Підтримуються JPEG, PNG та WebP')
            boundary = 'dim9000' + uuid.uuid4().hex
            raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="originalName"\r\n\r\n{name}\r\n'
                   f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                   f'Content-Type: {mime}\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
            result = c.request('POST', 'files/order/media/upload', raw=raw,
                               content_type='multipart/form-data; boundary=' + boundary)
            self.uploads.add(result['@id'])
            return result
        if action == 'create':
            kind = body.get('kind', 'orders')
            if kind not in ('orders', 'paid-orders'):
                raise ValueError('Невідомий тип заявки')
            data = body.get('data', {})
            if data.get('space') not in {s['@id'] for s in self.spaces()}:
                raise ValueError('Оберіть ваш об’єкт')
            if not str(data.get('description', '')).strip():
                raise ValueError('Додайте опис')
            allowed = {'space', 'description', 'category', 'gallery'} if kind == 'orders' else {'space', 'description', 'name'}
            if kind == 'orders' and data.get('category') not in CATEGORIES:
                raise ValueError('Оберіть категорію')
            self.check_files(data.get('gallery', {}).get('files', []))
            return c.request('POST', kind, {k: v for k, v in data.items() if k in allowed})

        path, order = self.context(body)
        if action == 'notifications':
            return order_notifications(c, path.split('/')[0], order['id'])
        if action == 'detail':
            if isinstance(order.get('review'), str):
                order['review'] = c.request('GET', order['review'].removeprefix('/api/'))
            return {'order': order, 'transitions': c.request('GET', path + '/transit')}
        if action == 'history':
            resource = 'order-updates' if path.startswith('orders/') else 'paid-order-updates'
            result = c.request('GET', 'history/' + resource + '?' + urlencode({
                'orderId': order['id'], 'itemsPerPage': 100, 'page': max(1, int(body.get('page', 1))),
                'order[createdAt]': 'asc'}))
            result['hydra:member'] = [x for x in result.get('hydra:member', []) if iri(x.get('order')) == order['@id']]
            return result
        if action == 'update':
            data = body.get('data', {})
            allowed = {'description', 'category'} if path.startswith('orders/') else {'description'}
            if not data or not set(data) <= allowed:
                raise ValueError('Можна змінити опис і категорію')
            return c.request('PUT', path, data)
        if action == 'transition':
            transition = body.get('transition')
            if transition not in c.request('GET', path + '/transit'):
                raise ValueError('Ця дія недоступна для поточного статусу')
            return c.request('PATCH', path + '/transit', {'transition': transition})
        if action == 'review':
            data = body.get('data', {})
            rating = int(data.get('rating', 0))
            if not 1 <= rating <= 5:
                raise ValueError('Оцінка має бути від 1 до 5')
            review = order.get('review')
            payload = {'rating': rating, 'comment': str(data.get('comment', ''))}
            if review:
                return c.request('PATCH', iri(review).removeprefix('/api/'), payload)
            payload['order'] = order['@id']
            return c.request('POST', 'reviews' if path.startswith('orders/') else 'paid-reviews', payload)
        if action == 'gallery':
            files = body.get('files', [])
            gallery = order.get('gallery')
            existing = {iri(f) for f in (gallery or {}).get('files', [])}
            self.check_files(files, existing)
            if not gallery:
                raise ValueError('Галерея для цієї заявки недоступна')
            return c.request('PATCH', iri(gallery).removeprefix('/api/'), {'files': files})

        if action in ('chat', 'message', 'edit_message', 'topic'):
            topic = order.get('topicId')
            if not topic:
                topics = c.request('GET', 'topics?' + urlencode({
                    'filter': 'externalId||$eq||' + str(order['id']), 'limit': 100}), service='chat')
                matches = [t for t in topics.get('data', []) if str(t.get('externalId')) in (str(order['id']), order['@id'])]
                topic = matches[0]['id'] if matches else None
            if not topic and action in ('topic', 'message'):
                if not path.startswith('orders/'):
                    raise ValueError('Створення чату платної заявки не знайдено в API застосунку')
                result = c.request('POST', 'orders/chat/topic', {'order': order['@id']})
                topic = result.get('topicId')
            if not topic:
                return {'data': [], 'total': 0, 'pageCount': 0, 'topicId': None}
            if action == 'chat':
                result = c.request('GET', 'messages?' + urlencode({'filter': 'topic.id||$eq||' + topic,
                    'sort': 'createdAt,DESC', 'page': max(1, int(body.get('page', 1))), 'limit': 30}), service='chat')
                # Guard against a server silently ignoring the filter.
                result['data'] = [m for m in result.get('data', []) if m.get('topicId', (m.get('topic') or {}).get('id')) == topic]
                result['topicId'] = topic
                return result
            if action == 'topic':
                return {'topicId': topic}
            if action == 'message':
                if not str(body.get('text', '')).strip():
                    raise ValueError('Напишіть повідомлення')
                return c.request('POST', 'messages', {'type': 'text', 'body': body['text'], 'topic': topic}, service='chat')
            message_id = str(body.get('messageId', ''))
            if not message_id.isdigit():
                raise ValueError('Невірний номер повідомлення')
            msg = c.request('GET', 'messages/' + message_id, service='chat')
            if msg.get('topicId', (msg.get('topic') or {}).get('id')) != topic:
                raise ValueError('Повідомлення належить іншій заявці')
            return c.request('PATCH', 'messages/' + message_id,
                             {'body': str(body.get('text', ''))}, service='chat')
        raise ValueError('Невідома дія')

    def check_files(self, files, existing=None):
        if not isinstance(files, list) or len(files) > 5 or not all(isinstance(f, str) for f in files):
            raise ValueError('Дозволено до 5 фотографій')
        if not set(files) <= (self.uploads | (existing or set())):
            raise ValueError('Спочатку завантажте фотографії через цю сторінку')
