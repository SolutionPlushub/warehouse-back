import { ENDPOINT_ACCESS } from './endpoint-access';
import { PERMISSIONS } from './permission-catalog';

/** Écrans sans route métier propre : le droit ne fait qu'afficher la page. */
const UI_ONLY = new Set(['portal.read', 'contracts.read', 'contracts.manage']);

function collect(value: unknown, into: Set<string>) {
  if (typeof value === 'string') {
    if (value !== 'authenticated') into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collect(item, into));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collect(item, into));
  }
}

describe('endpoint access', () => {
  it('relie chaque permission du catalogue à une route, sauf les écrans purement visuels', () => {
    const used = new Set<string>();
    collect(ENDPOINT_ACCESS, used);
    const missing = PERMISSIONS.map((permission) => permission.code).filter(
      (code) => !used.has(code) && !UI_ONLY.has(code),
    );
    expect(missing).toEqual([]);
  });
});
