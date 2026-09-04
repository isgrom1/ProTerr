/**
 * La categoría de conservación se consulta en línea y se guarda lo consultado.
 * Lo crítico es que la app NUNCA invente una categoría: un dato equivocado en
 * un informe que va a la autoridad es un error caro.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { consultar, consultarVarias, estadoCache, limpiarCache, setEndpoint } from './lookup';

const ENDPOINT = 'https://ejemplo.cl/rce';

function respuesta(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof globalThis.fetch;
}

beforeEach(async () => {
  await db.settings.clear();
  await setEndpoint(ENDPOINT);
});

describe('consulta en línea de la categoría', () => {
  it('pregunta al servicio y devuelve la categoría vigente', async () => {
    const fetch = respuesta({ categoria: 'EN', origen: 'Nativa', endemica: true, fuente: 'Nómina MMA', fechaFuente: '2026-06-08' });
    const c = await consultar('Lycalopex fulvipes', { fetch });
    expect(c?.status?.rce).toBe('EN');
    expect(c?.status?.source).toBe('Nómina MMA · 2026-06-08');
    expect(c?.desdeCache).toBe(false);
  });

  it('lo consultado una vez responde después sin señal', async () => {
    const online = respuesta({ categoria: 'CR' });
    await consultar('Aegla papudo', { fetch: online });

    // Ahora no hay red: la función de fetch revienta.
    const caida = vi.fn(async () => { throw new Error('sin conexión'); }) as unknown as typeof globalThis.fetch;
    const c = await consultar('Aegla papudo', { fetch: caida });
    expect(c?.status?.rce).toBe('CR');
    expect(c?.desdeCache).toBe(true);
  });

  it('sin señal y sin haber consultado nunca, no inventa nada', async () => {
    const caida = vi.fn(async () => { throw new Error('sin conexión'); }) as unknown as typeof globalThis.fetch;
    expect(await consultar('Especie nunca vista', { fetch: caida })).toBeNull();
  });

  it('una especie sin categoría en la nómina no es lo mismo que no consultada', async () => {
    // El servicio responde, y responde que no está clasificada. Eso es un dato.
    const c = await consultar('Passer domesticus', { fetch: respuesta({ categoria: null }) });
    expect(c).not.toBeNull();
    expect(c?.status).toBeNull();
  });

  it('un error del servicio no se toma como respuesta', async () => {
    const c = await consultar('Puma concolor', { fetch: respuesta({ categoria: 'LC' }, false) });
    expect(c).toBeNull();
  });

  it('sin servicio configurado no consulta nada', async () => {
    await setEndpoint(null);
    const fetch = respuesta({ categoria: 'EN' });
    expect(await consultar('Lycalopex fulvipes', { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('no vuelve a preguntar lo que ya tiene, salvo que se fuerce', async () => {
    const fetch = respuesta({ categoria: 'VU' });
    await consultar('Liolaemus tenuis', { fetch });
    await consultar('Liolaemus tenuis', { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);

    await consultar('Liolaemus tenuis', { fetch, forzar: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('consulta varias sin repetir las que se dicen dos veces', async () => {
    const fetch = respuesta({ categoria: 'LC' });
    const m = await consultarVarias(['Diuca diuca', 'Diuca diuca', ' Mimus thenca '], { fetch });
    expect(m.size).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('deja ver cuántas especies tiene guardadas y de cuándo', async () => {
    await consultar('Diuca diuca', { fetch: respuesta({ categoria: 'LC' }) });
    const estado = await estadoCache();
    expect(estado.especies).toBe(1);
    expect(estado.masAntigua).toMatch(/^\d{4}-\d{2}-\d{2}/);

    expect(await limpiarCache()).toBe(1);
    expect((await estadoCache()).especies).toBe(0);
  });

  it('el endpoint guardado no se pierde al limpiar lo consultado', async () => {
    await consultar('Diuca diuca', { fetch: respuesta({ categoria: 'LC' }) });
    await limpiarCache();
    const fetch = respuesta({ categoria: 'LC' });
    await consultar('Diuca diuca', { fetch });
    expect(fetch).toHaveBeenCalled();
  });
});
