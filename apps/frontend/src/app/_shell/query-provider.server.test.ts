import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { QueryProvider } from './query-provider';

it('서버 렌더마다 독립된 쿼리 캐시를 만든다', () => {
  const clients: QueryClient[] = [];
  function Probe() {
    const client = useQueryClient();
    expect(client.getQueryData(['private-data'])).toBeUndefined();
    client.setQueryData(['private-data'], 'private-value');
    clients.push(client);
    return null;
  }

  renderToString(createElement(QueryProvider, { children: createElement(Probe) }));
  renderToString(createElement(QueryProvider, { children: createElement(Probe) }));

  expect(clients).toHaveLength(2);
  expect(clients[0]).not.toBe(clients[1]);
  clients.forEach((client) => {
    client.clear();
  });
});
