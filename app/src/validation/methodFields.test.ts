/**
 * Cada metodología ofrece sólo la evidencia que puede producir.
 */
import { describe, expect, it } from 'vitest';
import { recordTypeOptions } from './methodFields';

describe('tipos de registro por metodología', () => {
  it('una trampa Sherman sólo entrega individuos capturados', () => {
    expect(recordTypeOptions('trampa_sherman')).toEqual(['Individuo']);
  });

  it('una grabadora no ve: sólo audio', () => {
    expect(recordTypeOptions('songmeter')).toEqual(['Registro de audio', 'Vocalización']);
  });

  it('una cámara trampa no oye', () => {
    expect(recordTypeOptions('camara_trampa')).not.toContain('Vocalización');
    expect(recordTypeOptions('camara_trampa')).toContain('Huella');
  });

  it('un transecto puede encontrar cualquier evidencia', () => {
    const todos = recordTypeOptions('transecto');
    expect(todos).toContain('Egagrópila');
    expect(todos).toContain('Fecas');
    expect(todos).toContain('Vocalización');
  });

  it('respeta el vocabulario del proyecto', () => {
    // Si la organización sólo declara dos evidencias, no se inventan más.
    expect(recordTypeOptions('transecto', ['Individuo', 'Fecas'])).toEqual(['Individuo', 'Fecas']);
    expect(recordTypeOptions('trampa_sherman', ['Individuo', 'Fecas'])).toEqual(['Individuo']);
  });

  it('nunca esconde el valor que un registro ya tiene', () => {
    // Un registro antiguo con una evidencia que hoy no se ofrece debe poder
    // seguir mostrándola: si no, editarlo la borraría en silencio.
    expect(recordTypeOptions('trampa_sherman', undefined, 'Fecas')).toEqual(['Individuo', 'Fecas']);
  });

  it('una metodología sin regla propia muestra todo', () => {
    expect(recordTypeOptions('otro')).toContain('Egagrópila');
    expect(recordTypeOptions(null)).toContain('Egagrópila');
  });
});
