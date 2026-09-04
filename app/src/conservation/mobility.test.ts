import { describe, expect, it } from 'vitest';
import taxaSeed from '../data/seed/taxa.json';
import type { Taxon } from '../domain/types';
import { locationFixNeed, mobilityOf, suggestsPhoto } from './mobility';

const taxa = taxaSeed as unknown as Taxon[];
const byName = (n: string) => taxa.find((t) => t.commonName === n)!;

describe('movilidad de la especie', () => {
  it('las aves son de alta movilidad: no necesitan punto propio', () => {
    expect(mobilityOf(byName('Chucao'))).toBe('alta');
    expect(locationFixNeed(byName('Chucao'), 'Vocalización').required).toBe(false);
  });

  it('reptiles y anfibios sí: el individuo estaba justo ahí', () => {
    expect(mobilityOf(byName('Lagarto de Zapallar'))).toBe('baja');
    expect(mobilityOf(byName('Sapito de cuatro ojos'))).toBe('baja');
    const need = locationFixNeed(byName('Lagarto de Zapallar'), 'Individuo');
    expect(need.required).toBe(true);
    expect(need.reason).toBe('especie de baja movilidad');
  });

  it('un roedor es de baja movilidad; un puma no', () => {
    expect(mobilityOf(byName('Ratón chinchilla'))).toBe('baja');
    expect(mobilityOf(byName('Puma'))).toBe('alta');
  });

  it('la evidencia indirecta es un punto fijo, sea de la especie que sea', () => {
    const need = locationFixNeed(byName('Puma'), 'Fecas');
    expect(need.required).toBe(true);
    expect(need.reason).toContain('punto fijo');
  });

  it('una especie amenazada siempre lleva punto, aunque vuele', () => {
    const need = locationFixNeed(byName('Cóndor'), 'Individuo');
    expect(need.required).toBe(true);
    expect(need.reason).toBe('especie en categoría de conservación');
  });
});

describe('sugerencia de fotografía', () => {
  it('se sugiere en amenazadas, evidencia y dudas de identificación', () => {
    expect(suggestsPhoto(byName('Cóndor'), 'Individuo')).toBe(true);
    expect(suggestsPhoto(byName('Puma'), 'Fecas')).toBe(true);
    expect(suggestsPhoto(byName('Chucao'), 'Individuo', 'probable')).toBe(true);
  });

  it('no se sugiere en un ave común identificada con seguridad', () => {
    expect(suggestsPhoto(byName('Chucao'), 'Vocalización', 'seguro')).toBe(false);
  });
});
