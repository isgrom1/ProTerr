/**
 * Íconos propios, dibujados para esta app.
 *
 * Los emoji se veían distintos en cada teléfono —y en algunos, no se veían—,
 * cambiaban de color solos y le quitaban seriedad a una herramienta que
 * produce un informe para la autoridad. Estos son de trazo, heredan el color
 * del texto y engrosan solos en modo sol (`--stroke`), que es cuando la
 * pantalla pierde contraste.
 *
 * Se dibujan sobre una caja de 24 y se leen a 24 px con el brazo estirado.
 */
export type IconName =
  | 'microfono' | 'confirmar' | 'registros' | 'jornada' | 'resumen' | 'ajustes'
  | 'transecto' | 'playback' | 'anfibio' | 'camara' | 'trampa' | 'grabadora'
  | 'ave' | 'luna' | 'cronometro' | 'ruta' | 'ojo' | 'otro'
  | 'sol' | 'sombra' | 'noche';

const P: Record<IconName, string> = {
  // --- navegación ---
  microfono: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  confirmar: 'M4 12.5 9.5 18 20 6',
  registros: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  jornada: 'M3 7h4l2-2h6l2 2h4v12H3zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  resumen: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  ajustes: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',

  // --- metodologías ---
  transecto: 'M4 20c3-1 3-5 6-6s3 4 6 3 3-6 4-7M4 20h16',
  playback: 'M4 9v6h4l5 4V5L8 9zM17 9.5a4 4 0 0 1 0 5M20 7a8 8 0 0 1 0 10',
  anfibio: 'M6 13a3 3 0 0 1 6 0 3 3 0 0 1 6 0v3H6zM8 10.5V9M16 10.5V9M4 19l3-3M20 19l-3-3',
  camara: 'M3 6h18v13H3zM3 10h18M7 6V4h5v2M9 15.5h6',
  trampa: 'M3 8h18v9H3zM3 12h18M8 8V5M16 8v-3M12 17v3',
  grabadora: 'M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4',
  ave: 'M4 15c4 0 7-2 9-6 1.5 3 3.5 4 6 4-1 4-4 7-8 7-3.5 0-6-2-7-5ZM17 8.5h.01',
  luna: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  cronometro: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 9v4l2.5 2M9 2h6',
  ruta: 'M7 21c-2 0-3-1.4-3-3s1-3 3-3h10c2 0 3-1.4 3-3s-1-3-3-3H8M7 21h.01M17 3h.01',
  ojo: 'M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  otro: 'M6 4h12v16H6zM9 9h6M9 13h6M9 17h3',

  // --- modos de pantalla ---
  sol: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  sombra: 'M17 6.5a7 7 0 1 1-9.9 9.9A7.5 7.5 0 0 0 17 6.5ZM3 20h18',
  noche: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
};

export function Icono({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="var(--stroke, 1.8)"
      strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name]} />
    </svg>
  );
}

/** Ícono de cada metodología. */
export const ICONO_METODO: Record<string, IconName> = {
  transecto: 'transecto',
  playback_aves: 'playback',
  playback_anfibios: 'anfibio',
  camara_trampa: 'camara',
  trampa_sherman: 'trampa',
  songmeter: 'grabadora',
  transito_aereo: 'ave',
  transito_aereo_nocturno: 'luna',
  punto_conteo: 'cronometro',
  atropello: 'ruta',
  registro_oportunista: 'ojo',
  otro: 'otro',
};
