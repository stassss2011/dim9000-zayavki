import unittest
from urllib.parse import parse_qs, urlsplit

from notifications import order_notifications


class NotificationClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def request(self, method, path):
        self.calls.append((method, path))
        page = int(parse_qs(urlsplit(path).query)['page'][0])
        return self.pages[page - 1]


def notification(ident, **extra):
    return {'id': ident, 'order': {'@id': '/api/orders/42'},
            'type': 'order_deadline_updated', 'createdAt': '2030-01-01T09:00:00+00:00',
            'payload': {'comment': 'Тестовий коментар.', 'newDeadline': '2030-02-01T00:00:00+00:00'}, **extra}


class NotificationTests(unittest.TestCase):
    def test_loads_later_pages_and_preserves_comment_without_marking_read(self):
        client = NotificationClient([
            {'hydra:member': [notification('other', order='/api/orders/99')], 'hydra:view': {'hydra:next': '/api/notifications?page=2'}},
            {'hydra:member': [notification('mine')]},
        ])
        result = order_notifications(client, 'orders', 42)
        self.assertEqual(len(result['data']), 1)
        self.assertEqual(result['data'][0]['comment'], 'Тестовий коментар.')
        self.assertEqual(result['data'][0]['newDeadline'], '2030-02-01T00:00:00+00:00')
        self.assertTrue(all(method == 'GET' for method, _ in client.calls))

    def test_does_not_mix_paid_orders_or_trust_conflicting_payload(self):
        rows = [notification('paid', order=None, paidOrder='/api/paid-orders/42', payload={'objectId': '42', 'type': 'paid_order'}),
                notification('conflict', order='/api/orders/99', payload={'objectId': '42', 'type': 'order'}),
                notification('unrelated', order=None, type='announce', payload={'objectId': '42'}),
                notification('fallback', order=None, payload={'objectId': '42', 'type': 'order_deadline_updated'})]
        result = order_notifications(NotificationClient([{'hydra:member': rows}]), 'orders', 42)
        self.assertEqual([x['id'] for x in result['data']], ['fallback'])
        result = order_notifications(NotificationClient([{'hydra:member': rows}]), 'paid-orders', 42)
        self.assertEqual([x['id'] for x in result['data']], ['paid'])

    def test_decodes_transition_and_tolerates_malformed_optional_payload(self):
        rows = [notification('transition', payload={'transition': '{"from":"new","to":"consideration"}'}),
                notification('bad', payload={'transition': 'broken'}), notification('empty', payload=None)]
        result = order_notifications(NotificationClient([{'hydra:member': rows}]), 'orders', 42)
        self.assertEqual(result['data'][0]['transition'], {'from': 'new', 'to': 'consideration'})
        self.assertEqual(result['data'][1]['transition'], {})
        self.assertEqual(result['data'][2]['comment'], '')

    def test_deduplicates_records_across_pages(self):
        row = notification('same')
        result = order_notifications(NotificationClient([
            {'hydra:member': [row], 'hydra:view': {'hydra:next': '?page=2'}},
            {'hydra:member': [row, notification('new')]},
        ]), 'orders', 42)
        self.assertEqual(len(result['data']), 2)


if __name__ == '__main__':
    unittest.main()
