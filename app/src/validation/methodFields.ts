/**
 * Qué evidencia puede producir cada metodología.
 *
 * Una trampa Sherman no entrega huellas ni egagrópilas: entrega un animal
 * capturado. Una cámara trampa no entrega vocalizaciones. Ofrecer las trece
 * opciones siempre obliga a leerlas todas para encontrar la única que aplica,
 * y deja la puerta abierta a elegir una que es imposible.
 *
 * Es dato, no código: una organización puede ampliarlo sin tocar el parser
 * (igual que el léxico). Una metodología que no esté aquí muestra todo.
 */
import type { MethodCode, RecordType } from '../domain/types';

const TODOS: RecordType[] = [
  'Individuo', 'Vocalización', 'Huella', 'Fecas', 'Madriguera', 'Cururera',
  'Plumas', 'Muda', 'Huesos', 'Nido', 'Egagrópila', 'Registro de audio', 'Otro',
];

export const RECORD_TYPES_BY_METHOD: Partial<Record<MethodCode, RecordType[]>> = {
  // El animal está en la trampa: es un individuo capturado y nada más.
  trampa_sherman: ['Individuo'],
  // La cámara ve; no oye. Y lo que fotografía es el animal o su huella.
  camara_trampa: ['Individuo', 'Huella', 'Otro'],
  // La grabadora sólo deja audio.
  songmeter: ['Registro de audio', 'Vocalización'],
  // El playback busca respuesta: se ve o se oye al animal, no su rastro.
  playback_aves: ['Vocalización', 'Individuo'],
  playback_anfibios: ['Vocalización', 'Individuo'],
  // Volando: se ve, o se oye pasar de noche.
  transito_aereo: ['Individuo'],
  transito_aereo_nocturno: ['Individuo', 'Vocalización'],
  // Un atropello es un animal muerto en la ruta.
  atropello: ['Individuo'],
  // Un punto de conteo registra lo que se ve y lo que se oye desde el punto.
  punto_conteo: ['Individuo', 'Vocalización'],
};

/**
 * Opciones de tipo de registro para la metodología, respetando el vocabulario
 * que traiga el proyecto. El valor ya elegido nunca se esconde: un registro
 * viejo no puede quedar sin su propia opción en la lista.
 */
export function recordTypeOptions(
  method: MethodCode | null,
  vocabulary?: string[],
  current?: string | null,
): string[] {
  const base = vocabulary?.length ? vocabulary : TODOS;
  const permitidos = method ? RECORD_TYPES_BY_METHOD[method] : undefined;
  if (!permitidos) return base;
  // Manda el orden de la regla, no el del vocabulario: está escrito con lo
  // más probable primero, que es lo que se quiere tocar sin buscar.
  const lista = (permitidos as string[]).filter((v) => base.includes(v));
  if (current && !lista.includes(current)) lista.push(current);
  return lista;
}
