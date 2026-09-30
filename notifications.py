"""Notification explanations are distinct from order history and chat messages."""
import json
from urllib.parse import urlencode


def as_object(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def relation_iri(value):
    return value.get('@id') if isinstance(value, dict) else value


def belongs_to_order(notification, kind, ident):
    relation = 'order' if kind == 'orders' else 'paidOrder'
    opposite = 'paidOrder' if relation == 'order' else 'order'
    if notification.get(relation):
        return relation_iri(notification[relation]) == f'/api/{kind}/{ident}'
    if notification.get(opposite):
        return False
    payload = as_object(notification.get('payload'))
    event_type = payload.get('type') or notification.get('type', '')
    prefix = 'order' if kind == 'orders' else 'paid_order'
    return (event_type == prefix or event_type.startswith(prefix + '_')) and str(payload.get('objectId')) == str(ident)


def order_notifications(client, kind, ident):
    # The live Hydra schema has no order-id filter. Fetch the authenticated
    # recipient's collection completely, then match the exact relation locally.
    result, seen = [], set()
    for page in range(1, 1001):
        collection = client.request('GET', 'notifications?' + urlencode({
            'page': page, 'itemsPerPage': 100, 'order[createdAt]': 'desc'}))
        for item in collection.get('hydra:member', []):
            key = item.get('id') or item.get('@id')
            if key in seen or not belongs_to_order(item, kind, ident):
                continue
            seen.add(key)
            payload = as_object(item.get('payload'))
            result.append({
                'id': key, 'type': item.get('type'), 'createdAt': item.get('createdAt'),
                'comment': payload.get('comment') or '', 'newDeadline': payload.get('newDeadline'),
                'status': payload.get('objectStatus') or item.get('status'),
                'transition': as_object(payload.get('transition')), 'payload': payload,
            })
        if not collection.get('hydra:view', {}).get('hydra:next'):
            return {'data': result, 'total': len(result)}
    raise ValueError('Забагато сторінок сповіщень: повне завантаження не завершено')
