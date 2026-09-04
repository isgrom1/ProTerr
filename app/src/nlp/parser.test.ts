/**
 * Casos de prueba del brief (§35) más los de regresión que aparecieron al
 * afinar el parser. Se ejecutan contra el catálogo real extraído de la
 * planilla (889 taxones), no contra un fixture reducido.
 */
import { describe, expect, it } from 'vitest';
import taxaSeed from '../data/seed/taxa.json';
import type { Taxon } from '../domain/types';
import { parseUtterance } from './parser';
import { TaxonIndex } from './taxonIndex';

const index = new TaxonIndex(taxaSeed as unknown as Taxon[]);
const STATIONS = ['EMF09', 'EMF10', 'PMF34'];
const parse = (text: string) => parseUtterance(text, { taxonIndex: index, stationCodes: STATIONS });
const nameOf = (ids: string[]) => index.get(ids[0])?.commonName ?? null;
const sciOf = (ids: string[]) => index.get(ids[0])?.scientificName ?? null;

describe('catálogo', () => {
  it('carga el catálogo de arranque de ProTerr más los comodines de grupo', () => {
    expect(index.size).toBeGreaterThan(150);
    expect(index.all().filter((t) => t.isPlaceholder)).toHaveLength(8);
  });
});

describe('casos del brief', () => {
  it('caso 1: "EMF09 chucao uno sonido"', () => {
    const r = parse('EMF09 chucao uno sonido');
    expect(r.stationCode).toBe('EMF09');
    expect(r.observations).toHaveLength(1);
    const o = r.observations[0];
    expect(nameOf(o.taxonIds)).toBe('Chucao');
    expect(sciOf(o.taxonIds)).toBe('Scelorchilus rubecula');
    expect(o.individualCount).toBe(1);
    expect(o.recordType).toBe('Vocalización');
    expect(o.evidenceKind).toBe('Directo');
  });

  it('caso 2: "Tres rayaditos"', () => {
    const [o] = parse('Tres rayaditos').observations;
    expect(nameOf(o.taxonIds)).toBe('Rayadito');
    expect(o.individualCount).toBe(3);
    expect(o.countInferred).toBe(false);
  });

  it('caso 3: "Picaflor chico macho"', () => {
    const [o] = parse('Picaflor chico macho').observations;
    expect(nameOf(o.taxonIds)).toBe('Picaflor chico');
    expect(o.sex).toBe('Macho');
    expect(o.individualCount).toBe(1);
    expect(o.countInferred).toBe(true);
    expect(o.sexScope).toBe('todos');
  });

  it('caso 4: "Dos tiuques volando hacia el norte, altura veinte metros"', () => {
    const [o] = parse('Dos tiuques volando hacia el norte, altura veinte metros').observations;
    expect(nameOf(o.taxonIds)).toBe('Tiuque');
    expect(o.individualCount).toBe(2);
    expect(o.behaviour).toBe('Volando');
    expect(o.aerial?.flightDirection).toBe('N');
    expect(o.aerial?.flightHeightMeters).toBe(20);
  });

  it('caso 5: "Fecas de puma" no inventa un individuo', () => {
    const [o] = parse('Fecas de puma').observations;
    expect(nameOf(o.taxonIds)).toBe('Puma');
    expect(o.recordType).toBe('Fecas');
    expect(o.evidenceKind).toBe('Indirecto');
    expect(o.individualCount).toBeNull();
    expect(o.countInferred).toBe(false);
  });

  it('caso 6: "Un chucao" deja el tipo de registro marcado como inferido', () => {
    const [o] = parse('Un chucao').observations;
    expect(nameOf(o.taxonIds)).toBe('Chucao');
    expect(o.individualCount).toBe(1);
    expect(o.recordType).toBe('Individuo');
    expect(o.recordTypeInferred).toBe(true);
  });
});

describe('múltiples observaciones en una frase', () => {
  it('"Tres rayaditos, picaflor chico macho, una loica alimentándose" -> 3 registros', () => {
    const r = parse('Tres rayaditos, picaflor chico macho, una loica alimentándose.');
    expect(r.observations).toHaveLength(3);
    const [a, b, c] = r.observations;
    expect([nameOf(a.taxonIds), a.individualCount]).toEqual(['Rayadito', 3]);
    expect([nameOf(b.taxonIds), b.sex, b.individualCount]).toEqual(['Picaflor chico', 'Macho', 1]);
    expect([nameOf(c.taxonIds), c.behaviour, c.individualCount]).toEqual(['Loica', 'Alimentándose', 1]);
  });

  it('contexto dicho una vez se aplica a toda la frase', () => {
    const r = parse('LDB de fauna diaria, EMF09, chucao, 1 sonido');
    expect(r.method).toBe('transecto');
    expect(r.stationCode).toBe('EMF09');
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0].recordType).toBe('Vocalización');
    expect(r.observations[0].individualCount).toBe(1);
  });
});

describe('frases libres del brief §2', () => {
  const cases: Array<[string, Partial<Record<string, unknown>>]> = [
    ['Chucao cantando', { commonName: 'Chucao', recordType: 'Vocalización', behaviour: 'Vocalizando' }],
    ['Un chucao, escuchado', { commonName: 'Chucao', recordType: 'Vocalización', individualCount: 1 }],
    ['Dos rayaditos', { commonName: 'Rayadito', individualCount: 2 }],
    ['Picaflor chico macho', { commonName: 'Picaflor chico', sex: 'Macho' }],
    ['Un zorro culpeo, juvenil, caminando', { commonName: 'Zorro culpeo', lifeStage: 'Juvenil', behaviour: 'Corriendo' }],
    ['Encontré fecas de puma', { commonName: 'Puma', recordType: 'Fecas', individualCount: null }],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}"`, () => {
      const [o] = parse(text).observations;
      expect(o).toBeDefined();
      for (const [k, v] of Object.entries(expected)) {
        if (k === 'commonName') expect(nameOf(o.taxonIds)).toBe(v);
        else expect((o as unknown as Record<string, unknown>)[k]).toBe(v);
      }
    });
  }

  it('"Un ave no identificada, vocalización" se registra a nivel de clase', () => {
    const r = parse('Un ave no identificada, vocalización');
    // Antes esto se perdía; ahora el catálogo trae comodines por grupo.
    expect(nameOf(r.observations[0].taxonIds)).toBe('Ave no identificada');
    expect(r.observations[0].recordType).toBe('Vocalización');
  });
});

describe('robustez', () => {
  it('acepta errores menores de escritura y pide confirmarlos', () => {
    const [o] = parse('un chukao cantando').observations;
    expect(nameOf(o.taxonIds)).toBe('Chucao');
    expect(o.taxonCorrectedFrom).toBe('chukao');
  });

  it('resolver un plural no cuenta como corrección: no pregunta nada', () => {
    const [o] = parse('tres rayaditos').observations;
    expect(nameOf(o.taxonIds)).toBe('Rayadito');
    expect(o.taxonCorrectedFrom).toBeUndefined();
  });

  it('acepta el nombre científico y la abreviatura', () => {
    expect(nameOf(parse('Scelorchilus rubecula').observations[0].taxonIds)).toBe('Chucao');
    expect(nameOf(parse('dos S. rubecula').observations[0].taxonIds)).toBe('Chucao');
  });

  it('marca la ambigüedad en vez de elegir por su cuenta', () => {
    const [o] = parse('un ratón').observations;
    expect(o.taxonNeedsDisambiguation || o.taxonIds.length > 1 || index.get(o.taxonIds[0])?.isPlaceholder).toBeTruthy();
  });

  it('no asigna sexo al grupo completo sin preguntar', () => {
    const [o] = parse('5 individuos de zorro culpeo, sexo macho').observations;
    expect(o.individualCount).toBe(5);
    expect(o.sex).toBe('Macho');
    expect(o.sexScope).toBe('sin_definir');
  });

  it('reconoce la estación aunque el dictado la separe', () => {
    expect(parse('EMF 10, chucao').stationCode).toBe('EMF10');
  });

  it('registra un cadáver como individuo muerto, no como evidencia indirecta', () => {
    const [o] = parse('un zorro culpeo muerto').observations;
    expect(o.organismCondition).toBe('Muerto');
    expect(o.recordType).toBe('Individuo');
  });
});

describe('aristas de terreno', () => {
  it('registra la duda del observador en vez de convertirla en certeza', () => {
    const [o] = parse('creo que un chercán').observations;
    expect(nameOf(o.taxonIds)).toBe('Chercán');
    expect(o.identificationConfidence).toBe('probable');
  });

  it('distingue "posible" de "probable"', () => {
    expect(parse('posible zorro culpeo').observations[0].identificationConfidence).toBe('posible');
    expect(parse('un chucao').observations[0].identificationConfidence).toBe('seguro');
  });

  it('captura la distancia de detección', () => {
    const [o] = parse('un chucao a veinte metros').observations;
    expect(o.detectionDistanceMeters).toBe(20);
    expect(o.individualCount).toBe(1);
  });

  it('no confunde la distancia de detección con la altura de vuelo', () => {
    const [o] = parse('dos tiuques volando, altura treinta metros, a cincuenta metros').observations;
    expect(o.aerial?.flightHeightMeters).toBe(30);
    expect(o.detectionDistanceMeters).toBe(50);
  });

  it('reconoce la ausencia declarada como dato', () => {
    const r = parse('sin registros en EMF09');
    expect(r.noDetections).toBe(true);
    expect(r.stationCode).toBe('EMF09');
    expect(r.warnings).toHaveLength(0);
  });

  it('captura una estación desconocida y avisa, en vez de descartarla', () => {
    const r = parse('ZZZ99, chucao');
    expect(r.stationCode).toBe('ZZZ99');
    expect(r.warnings.join(' ')).toContain('no está en el catálogo');
  });

  it('acepta comodines de grupo cuando no se llega a especie', () => {
    const [o] = parse('un ave no identificada, vocalización').observations;
    expect(nameOf(o.taxonIds)).toBe('Ave no identificada');
    expect(o.recordType).toBe('Vocalización');
    expect(index.get(o.taxonIds[0])?.taxonRank).toBe('class');
  });

  it('"una lagartija" se registra a nivel de orden', () => {
    const [o] = parse('una lagartija').observations;
    const taxon = index.get(o.taxonIds[0])!;
    expect(taxon.isPlaceholder).toBe(true);
    expect(taxon.order).toBe('Squamata');
  });

  it('un nombre común compartido por varias especies se pregunta, no se adivina', () => {
    // El catálogo de arranque no tiene ambigüedades, pero el de una consultora
    // sí puede tenerlas: el parser devuelve todos los candidatos.
    const ambiguo = new TaxonIndex([
      { ...index.all()[0], id: 'a1', commonName: 'Sapo de monte', searchKeys: ['sapo de monte'] },
      { ...index.all()[0], id: 'a2', commonName: 'Sapo de monte', searchKeys: ['sapo de monte'] },
    ] as Taxon[]);
    const [o] = parseUtterance('un sapo de monte', { taxonIndex: ambiguo }).observations;
    expect(o.taxonNeedsDisambiguation).toBe(true);
    expect(o.taxonIds).toEqual(['a1', 'a2']);
  });
});

describe('enumerar varios grupos de la misma especie', () => {
  const frase = 'Tres loicas vocalizando, una loica macho, una loica hembra, '
    + 'dos loicas vocalizando, un chincol macho, una loica hembra';

  it('produce un registro por grupo, sin fundirlos', () => {
    const r = parse(frase);
    expect(r.observations).toHaveLength(6);
    expect(r.observations.map((o) => [nameOf(o.taxonIds), o.individualCount, o.recordType, o.sex])).toEqual([
      ['Loica', 3, 'Vocalización', null],
      ['Loica', 1, 'Individuo', 'Macho'],
      ['Loica', 1, 'Individuo', 'Hembra'],
      ['Loica', 2, 'Vocalización', null],
      ['Chincol', 1, 'Individuo', 'Macho'],
      ['Loica', 1, 'Individuo', 'Hembra'],
    ]);
  });

  it('el sexo de un grupo no se filtra al siguiente', () => {
    const r = parse(frase);
    expect(r.observations[0].sex).toBeNull(); // las tres vocalizando, sin sexo
    expect(r.observations[3].sex).toBeNull();
  });
});

describe('nombres genéricos de terreno', () => {
  it('"tres golondrinas" ofrece las golondrinas del catálogo en vez de perderse', () => {
    const r = parse('tres golondrinas');
    expect(r.warnings).toHaveLength(0);
    const [o] = r.observations;
    expect(o.individualCount).toBe(3);
    expect(o.taxonNeedsDisambiguation).toBe(true);
    const nombres = o.taxonIds.map((id) => index.get(id)!.commonName);
    expect(nombres).toContain('Golondrina chilena');
    expect(nombres.length).toBeGreaterThan(1);
  });

  it('funciona con otros genéricos habituales', () => {
    for (const [texto, esperado] of [['un picaflor', 'Picaflor chico'], ['dos zorros', 'Zorro culpeo'], ['una gaviota', 'Gaviota dominicana']] as const) {
      const [o] = parse(texto).observations;
      expect(o.taxonIds.map((id) => index.get(id)!.commonName)).toContain(esperado);
      expect(o.taxonNeedsDisambiguation).toBe(true);
    }
  });

  it('cuando el genérico deja una sola candidata, la resuelve sin preguntar', () => {
    const [o] = parse('un cometocino').observations;
    expect(nameOf(o.taxonIds)).toBe('Cometocino de Gay');
    expect(o.taxonNeedsDisambiguation).toBe(false);
  });

  it('un nombre exacto le gana al genérico: "loica" no se vuelve ambiguo', () => {
    const [o] = parse('tres loicas').observations;
    expect(nameOf(o.taxonIds)).toBe('Loica');
    expect(o.taxonNeedsDisambiguation).toBe(false);
  });
});

describe('la vocalización llena la conducta, se diga como se diga', () => {
  it('"cantando" y "vocalización" dan el mismo registro', () => {
    for (const texto of ['un chucao cantando', 'un chucao, vocalización', 'un chucao escuchado']) {
      const [o] = parse(texto).observations;
      expect([texto, o.recordType, o.behaviour]).toEqual([texto, 'Vocalización', 'Vocalizando']);
    }
  });
});
