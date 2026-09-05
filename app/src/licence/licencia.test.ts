/**
 * Los tres caminos de acceso y, sobre todo, lo que el bloqueo NO hace.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { proveedorSimulado, setProveedorAds, SIN_ADS } from './ads';
import {
  acceso, activarPago, META_SEGUNDOS, registrarApertura, reiniciarLicencia,
  usarDiaAcreditado, verVideo,
} from './licencia';

/** Un día del ciclo, en horario de trabajo. */
const dia = (n: number) => new Date(2026, 8, 4 + n, 10, 0);

beforeEach(async () => {
  await db.settings.clear();
  await reiniciarLicencia();
  setProveedorAds(SIN_ADS);
});

describe('los dos días gratis del ciclo', () => {
  it('el primer uso abre el ciclo y deja registrar', async () => {
    const a = await registrarApertura(dia(1));
    expect(a.motivo).toBe('gratis');
    expect(a.puedeRegistrar).toBe(true);
    expect(a.jornada).toBe('2026-09-05');
  });

  it('al tercer día se cierra', async () => {
    await registrarApertura(dia(1));
    const a = await registrarApertura(dia(3));
    expect(a.motivo).toBe('bloqueado');
    expect(a.puedeRegistrar).toBe(false);
    expect(a.ciclo.diasParaGratis).toBe(5);
  });

  it('al octavo día vuelve a abrir solo', async () => {
    await registrarApertura(dia(1));
    expect((await registrarApertura(dia(8))).motivo).toBe('gratis');
  });
});

describe('liberar un día viendo videos', () => {
  it('cuarenta minutos acumulados valen una jornada', async () => {
    setProveedorAds(proveedorSimulado({ segundos: 600 }));
    await registrarApertura(dia(1));
    await registrarApertura(dia(3));

    for (let i = 0; i < 3; i++) {
      const r = await verVideo(dia(3));
      expect(r.liberadas).toBe(0);
      expect(r.acceso.puedeRegistrar).toBe(false);
    }
    const ultimo = await verVideo(dia(3));
    expect(ultimo.liberadas).toBe(1);
    expect(ultimo.acceso.diasAcreditados).toBe(1);
  });

  it('la barra avanza y dice cuántos videos faltan', async () => {
    setProveedorAds(proveedorSimulado({ segundos: 600 }));
    await registrarApertura(dia(1));
    await registrarApertura(dia(3));
    await verVideo(dia(3));

    const p = (await acceso(dia(3))).progreso;
    expect(p.segundos).toBe(600);
    expect(p.fraccion).toBeCloseTo(0.25);
    expect(p.faltan).toBe(1800);
    expect(p.videosFaltantes).toBe(60);
  });

  it('los segundos sobrantes quedan para el día siguiente', async () => {
    // Media hora hoy: no alcanza. Media hora mañana: alcanza y sobran 20 min.
    setProveedorAds(proveedorSimulado({ segundos: 1800 }));
    await registrarApertura(dia(1));
    await registrarApertura(dia(3));
    expect((await verVideo(dia(3))).liberadas).toBe(0);

    await registrarApertura(dia(4));
    const r = await verVideo(dia(4));
    expect(r.liberadas).toBe(1);
    expect(r.acceso.progreso.segundos).toBe(3600 - META_SEGUNDOS);
  });

  it('un video cerrado antes de tiempo no acredita nada', async () => {
    setProveedorAds(proveedorSimulado({ falla: true }));
    await registrarApertura(dia(1));
    await registrarApertura(dia(3));
    const r = await verVideo(dia(3));
    expect(r.visto).toBe(false);
    expect(r.acceso.progreso.segundos).toBe(0);
  });

  it('lleva la cuenta del tiempo total que la persona ha mirado avisos', async () => {
    setProveedorAds(proveedorSimulado({ segundos: 600 }));
    await registrarApertura(dia(3));
    await verVideo(dia(3));
    await verVideo(dia(3));
    expect((await acceso(dia(3))).totalVisto).toBe(1200);
  });
});

describe('gastar un día acreditado', () => {
  beforeEach(async () => {
    setProveedorAds(proveedorSimulado({ segundos: META_SEGUNDOS }));
    await registrarApertura(dia(1));
    await registrarApertura(dia(3));
    await verVideo(dia(3));
  });

  it('no se gasta solo: hay que pedirlo', async () => {
    // Alguien que abre la app un domingo a mirar el resumen no pierde su día.
    const a = await registrarApertura(dia(3));
    expect(a.diasAcreditados).toBe(1);
    expect(a.puedeRegistrar).toBe(false);
  });

  it('al pedirlo, abre la jornada', async () => {
    const a = await usarDiaAcreditado(dia(3));
    expect(a.motivo).toBe('acreditado');
    expect(a.puedeRegistrar).toBe(true);
    expect(a.diasAcreditados).toBe(0);
  });

  it('cerrar y volver a abrir el mismo día no cobra de nuevo', async () => {
    await usarDiaAcreditado(dia(3));
    setProveedorAds(proveedorSimulado({ segundos: META_SEGUNDOS }));
    await verVideo(dia(3));

    const a = await usarDiaAcreditado(dia(3));
    expect(a.puedeRegistrar).toBe(true);
    expect(a.diasAcreditados).toBe(1);
  });

  it('el día siguiente vuelve a estar cerrado', async () => {
    await usarDiaAcreditado(dia(3));
    expect((await registrarApertura(dia(4))).puedeRegistrar).toBe(false);
  });

  it('sin días acreditados, pedirlo no hace nada', async () => {
    await usarDiaAcreditado(dia(3));
    const a = await usarDiaAcreditado(dia(4));
    expect(a.puedeRegistrar).toBe(false);
  });

  it('la jornada nocturna no se corta a medianoche', async () => {
    await usarDiaAcreditado(new Date(2026, 8, 7, 22, 0));
    const a = await acceso(new Date(2026, 8, 8, 1, 30));
    expect(a.puedeRegistrar).toBe(true);
  });
});

describe('suscripción pagada', () => {
  it('abre todo sin mirar el ciclo', async () => {
    await registrarApertura(dia(1));
    const a = await activarPago(30, dia(3));
    expect(a.motivo).toBe('pagado');
    expect(a.puedeRegistrar).toBe(true);
    expect((await acceso(dia(20))).motivo).toBe('pagado');
  });

  it('se acaba cuando se acaba', async () => {
    await registrarApertura(dia(1));
    await activarPago(5, dia(3));
    expect((await acceso(dia(8))).puedeRegistrar).toBe(true);
    expect((await acceso(dia(9))).motivo).toBe('gratis');
    expect((await acceso(dia(10))).motivo).toBe('bloqueado');
  });

  it('renovar antes de vencer suma, no pisa', async () => {
    await activarPago(30, dia(1));
    const a = await activarPago(30, dia(10));
    expect(a.pagadoHasta).toBe('2026-11-04');
  });
});

describe('reloj corrido', () => {
  it('se anota pero no se castiga', async () => {
    await registrarApertura(dia(1));
    await registrarApertura(dia(10));
    const a = await registrarApertura(dia(2));
    expect(a.relojAlterado).toBe(true);
    // Sigue siendo día gratis del ciclo: no se le cierra la app a nadie por esto.
    expect(a.puedeRegistrar).toBe(true);
  });

  it('un desajuste de minutos no cuenta', async () => {
    await registrarApertura(dia(1));
    await registrarApertura(new Date(2026, 8, 7, 10, 0));
    const a = await registrarApertura(new Date(2026, 8, 7, 9, 58));
    expect(a.relojAlterado).toBe(false);
  });
});
