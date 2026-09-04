import { describe, expect, it } from 'vitest';
import { parseCommand } from './commands';

describe('comandos de voz', () => {
  const cases: Array<[string, unknown]> = [
    ['Nuevo registro', { kind: 'nuevo_registro' }],
    ['Agregar otro individuo', { kind: 'agregar_individuo', delta: 1 }],
    ['agregar 3 individuos', { kind: 'agregar_individuo', delta: 3 }],
    ['Agregar foto', { kind: 'agregar_foto' }],
    ['Editar abundancia 4', { kind: 'editar_abundancia', value: 4 }],
    ['Cambiar estación a EMF10', { kind: 'cambiar_estacion', stationCode: 'EMF10' }],
    ['Guardar', { kind: 'guardar' }],
    ['Eliminar', { kind: 'eliminar' }],
    ['Revisar pendientes', { kind: 'revisar_pendientes' }],
    ['¿Qué me falta?', { kind: 'que_me_falta' }],
    ['Duplicar registro', { kind: 'duplicar' }],
    ['Iniciar track', { kind: 'iniciar_track' }],
    ['comenzar el trackeo', { kind: 'iniciar_track' }],
    ['Cerrar track', { kind: 'cerrar_track' }],
    ['punto 100', { kind: 'marcar_punto', label: '100' }],
    ['marcar punto medio', { kind: 'marcar_punto', label: 'medio' }],
    ['pto final', { kind: 'marcar_punto', label: 'final' }],
    ['punto de inicio', { kind: 'marcar_punto', label: 'inicio' }],
    ['Sin detecciones', { kind: 'sin_detecciones' }],
    ['Otro igual', { kind: 'otro_igual', veces: 1 }],
    ['otra más', { kind: 'otro_igual', veces: 1 }],
    ['otros 3 iguales', { kind: 'otro_igual', veces: 3 }],
    ['Repetir', { kind: 'otro_igual', veces: 1 }],
    ['Deshacer', { kind: 'deshacer' }],
    ['me equivoqué', { kind: 'deshacer' }],
    ['corrige, eran dos', { kind: 'corregir', texto: 'eran dos' }],
    ['no se realizó, camino cortado', { kind: 'no_realizado', motivo: 'camino cortado' }],
    ['No se pudo hacer por lluvia', { kind: 'no_realizado', motivo: 'lluvia' }],
    ['no se hizo', { kind: 'no_realizado', motivo: null }],
    ['no, era hembra', { kind: 'corregir', texto: 'era hembra' }],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}"`, () => expect(parseCommand(text)).toEqual(expected));
  }

  it('una observación no se confunde con un comando', () => {
    expect(parseCommand('Chucao cantando')).toBeNull();
    expect(parseCommand('cambiar estación a EMF10 y un chucao')).toBeNull();
  });
});
