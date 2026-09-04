/**
 * Unir dos jornadas. Lo que importa probar es que la app AVISE antes de
 * escribir: el doble conteo de dos personas en el mismo transecto es
 * silencioso y arruina la abundancia.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { BACKUP_FORMAT, BACKUP_VERSION } from './backup';
import { previewMerge } from './merge';

const audit = {
  createdAt: '2026-09-04T10:00:00Z', createdBy: 'u1', updatedAt: '2026-09-04T10:00:00Z',
  updatedBy: 'u1', deletedAt: null, deviceId: 'dev1', syncState: 'pending' as const,
  syncError: null, syncedAt: null, revision: 1,
};

function evento(id: string, quien: string, deviceId = 'dev1') {
  return {
    id, projectId: 'p1', campaignId: 'c1', stationId: 'st1', siteId: null,
    method: 'transecto', eventDate: '2026-09-04', eventTime: '10:00',
    timezone: 'America/Santiago', utcOffsetMinutes: -240,
    deviceTimestamp: '2026-09-04T14:00:00Z', dateTimeEditedByUser: false,
    recordedBy: quien, weather: null, notes: null, deviceFix: null,
    ...audit, deviceId,
  };
}

function registro(id: string, eventId: string, taxonId: string, hora: string) {
  return {
    id, eventId, occurrenceId: `urn:demo:${id}`, occurrenceTime: hora,
    taxonId, verbatimTaxonText: null, recordType: 'Individuo', evidenceKind: 'Directo',
    individualCount: 1, sex: null, sexScope: 'sin_definir', lifeStage: null,
    lifeStageScope: 'sin_definir', organismCondition: 'Vivo', behaviour: null,
    notes: null, occurrenceFix: null, aerial: null, source: 'voz',
    verbatimUtterance: null, mediaIds: [], pendingFields: [], ...audit,
  };
}

function respaldo(data: Record<string, unknown[]>, deviceId = 'dev2') {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: '2026-09-04T20:00:00Z', deviceId, counts: {}, data };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.stations.put({
    id: 'st1', projectId: 'p1', stationCode: 'EMF44', finalStationCode: 'EMF44',
    darwinCoreLocationId: 'urn:demo:emf44', region: null, season: null, habitat: null,
    slopeAspect: null, utmEast: null, utmNorth: null, utmStartEast: null, utmStartNorth: null,
    utmEndEast: null, utmEndNorth: null, latitude: null, longitude: null,
    methods: ['transecto'], sites: [], recordedBy: null, identifiedBy: null,
  } as never);
  await db.events.put(evento('ev_isaac', 'Isaac Rojas') as never);
  await db.occurrences.put(registro('o_isaac', 'ev_isaac', 'tx_chucao', '10:05') as never);
});

describe('unir la jornada de dos personas', () => {
  it('dice de quién es, qué días y qué estaciones trae', async () => {
    const p = await previewMerge(respaldo({
      events: [evento('ev_diego', 'Diego Segovia', 'dev2')],
      occurrences: [registro('o_diego', 'ev_diego', 'tx_loica', '11:30')],
    }));
    expect(p.origen.deviceId).toBe('dev2');
    expect(p.origen.observadores).toEqual(['Diego Segovia']);
    expect(p.dias).toEqual(['2026-09-04']);
    expect(p.estaciones).toEqual(['EMF44']);
  });

  it('separa lo nuevo de lo que ya estaba', async () => {
    const p = await previewMerge(respaldo({
      events: [evento('ev_diego', 'Diego Segovia', 'dev2')],
      occurrences: [
        registro('o_diego', 'ev_diego', 'tx_loica', '11:30'),
        registro('o_isaac', 'ev_isaac', 'tx_chucao', '10:05'),
      ],
    }));
    expect(p.nuevos).toBe(1);
    expect(p.yaEstaban).toBe(1);
    expect(p.enConflicto).toBe(0);
  });

  it('marca el mismo registro con distinto contenido', async () => {
    const distinto = { ...registro('o_isaac', 'ev_isaac', 'tx_chucao', '10:05'), individualCount: 4 };
    const p = await previewMerge(respaldo({
      events: [evento('ev_isaac', 'Isaac Rojas')], occurrences: [distinto],
    }));
    expect(p.enConflicto).toBe(1);
  });

  it('avisa el posible doble conteo del mismo animal', async () => {
    // Los dos recorren el mismo transecto y anotan el mismo chucao con diez
    // minutos de diferencia. Sumarlos diría dos individuos donde había uno.
    const p = await previewMerge(respaldo({
      events: [evento('ev_diego', 'Diego Segovia', 'dev2')],
      occurrences: [registro('o_diego', 'ev_diego', 'tx_chucao', '10:15')],
    }));
    expect(p.posiblesDobles).toHaveLength(1);
    expect(p.posiblesDobles[0].observadores).toEqual(['Isaac Rojas', 'Diego Segovia']);
    expect(p.posiblesDobles[0].horas).toEqual(['10:05', '10:15']);
  });

  it('no avisa si pasó más de media hora: pueden ser dos animales', async () => {
    const p = await previewMerge(respaldo({
      events: [evento('ev_diego', 'Diego Segovia', 'dev2')],
      occurrences: [registro('o_diego', 'ev_diego', 'tx_chucao', '11:40')],
    }));
    expect(p.posiblesDobles).toHaveLength(0);
  });

  it('no avisa si los anotó la misma persona: vio dos', async () => {
    const p = await previewMerge(respaldo({
      events: [evento('ev_otro', 'Isaac Rojas', 'dev1')],
      occurrences: [registro('o_otro', 'ev_otro', 'tx_chucao', '10:15')],
    }));
    expect(p.posiblesDobles).toHaveLength(0);
  });

  it('no avisa si son especies distintas', async () => {
    const p = await previewMerge(respaldo({
      events: [evento('ev_diego', 'Diego Segovia', 'dev2')],
      occurrences: [registro('o_diego', 'ev_diego', 'tx_loica', '10:10')],
    }));
    expect(p.posiblesDobles).toHaveLength(0);
  });

  it('avisa si el respaldo del compañero vino sin fotografías', async () => {
    const p = await previewMerge(respaldo({
      events: [evento('ev_diego', 'Diego Segovia', 'dev2')],
      occurrences: [],
      media: [{ id: 'm1', blobOmitted: true }],
    }));
    expect(p.avisos.join(' ')).toContain('sin las fotografías');
  });

  it('no toca la base al mirar', async () => {
    await previewMerge(respaldo({
      events: [evento('ev_diego', 'Diego Segovia', 'dev2')],
      occurrences: [registro('o_diego', 'ev_diego', 'tx_loica', '11:30')],
    }));
    expect(await db.occurrences.count()).toBe(1);
  });

  it('rechaza un archivo que no es un respaldo', async () => {
    await expect(previewMerge({ hola: 1 })).rejects.toThrow('no es un respaldo');
  });
});
