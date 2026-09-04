# I. MVP y etapas

## I.1 Qué está construido y funcionando

El MVP **está implementado**, no propuesto. 240 pruebas verdes, `tsc` limpio,
build de producción y recorrido verificado en navegador con los archivos
exportados releídos y validados.

| Capacidad | Estado |
|---|---|
| Registro por voz y por texto en lenguaje natural | ✅ |
| Múltiples observaciones en una frase | ✅ |
| Fecha/hora/zona horaria automáticas, editables | ✅ |
| Catálogo propio de arranque con búsqueda tolerante y desambiguación | ✅ |
| Estaciones con autocompletado de todo su contexto | ✅ |
| GPS: sugerencia de estación por cercanía, sin cambio silencioso | ✅ |
| UTM ↔ WGS84 con huso y datum explícitos | ✅ |
| Perfiles de campos obligatorios configurables por metodología | ✅ |
| Validación inteligente con preguntas de un toque | ✅ |
| Guardado local inmediato, funcionamiento offline completo | ✅ |
| Cola de sincronización con reintentos y conflictos | ✅ |
| Fotografías: EXIF leído (coordenada, hora, rumbo, estación), comprimidas y orientadas | ✅ |
| Estaciones cargadas desde el KML/KMZ del proyecto | ✅ |
| Jornada completa importada desde las fotos, agrupada por punto | ✅ |
| Etiqueta de foto desfasada detectada contra el GPS | ✅ |
| Revisión, edición, duplicado y borrado lógico | ✅ |
| Auditoría campo a campo | ✅ |
| Resumen de jornada | ✅ |
| Exportación Excel con el formato que cargue cada consultora, CSV y DwC-A | ✅ |
| Plantillas por consultora: se sube su formulario y ProTerr exporta con esa forma | ✅ |
| Importación de datos históricos con validación previa | ✅ análisis y validación completos; la escritura a la base local queda en Etapa 2 |
| Comandos de voz | ✅ |
| Módulo de tránsito aéreo | ✅ |
| PWA instalable, offline vía service worker | ✅ |
| Registro rápido sin abrir ni cerrar muestreos, con hora propia por registro | ✅ |
| Track explícito por voz con waypoints (inicio, 100, 200, final) | ✅ |
| Punto GPS exigido sólo por movilidad, evidencia o conservación | ✅ |
| Ausencias explícitas, exportadas como `occurrenceStatus=absent` | ✅ |
| Confianza de identificación (`cf.` / `?`) | ✅ |
| Capa de conservación con alerta en terreno y fuente visible | ✅ mecanismo completo; la lista entregada es un EJEMPLO a reemplazar |
| Generalización de coordenadas sensibles al exportar | ✅ |
| Respaldo y restauración completa de la base local | ✅ |
| Panel de calidad: duplicados, vacíos, especies amenazadas sin foto | ✅ |
| Flujo de revisión terreno → revisado → validado | ✅ |
| Comodines por grupo, registro oportunista, distancia de detección | ✅ |
| Pantalla siempre encendida durante el muestreo | ✅ |

## I.2 Lo que deliberadamente no está

| Fuera de alcance | Por qué |
|---|---|
| **Backend** | La app funciona completa sin él. El contrato está definido (`SyncTransport`) y es de cuatro líneas |
| **Autenticación real** | Hay identidad local (usuario + dispositivo) suficiente para auditar. El login depende del backend |
| **Escritura del importador** | El análisis, la detección de hojas y la validación están hechos y probados contra la planilla real. Falta la transacción de escritura, que es mecánica una vez decidido cómo resolver los conflictos con datos ya existentes |
| **EXIF completo** | Se guarda el archivo original con sus metadatos; falta el parseo de EXIF para extraer orientación y GPS de la foto |
| **Lista oficial de conservación** | El mecanismo está completo y probado (`tools/cargar_conservacion.py`), pero el archivo que se entrega es un EJEMPLO de 20 especies marcadas como tal. Hay que cargar el Inventario Nacional de Especies del MMA antes de usarlo en un proyecto real |
| **Esfuerzo compartido entre varias personas** | Dos técnicos ya pueden registrar en paralelo sin colisión (UUID), pero no comparten un mismo muestreo abierto. Requiere el backend para arbitrar quién lo abre y lo cierra; resolverlo sólo en el dispositivo daría una cifra falsa. Ver [J](J-aristas-adicionales.md) |

## I.3 Etapas siguientes

**Etapa 2 — cerrar el ciclo de datos**
1. Escritura del importador con resolución de duplicados.
2. Backend mínimo: `PUT /<entidad>/<uuid>` idempotente + `409` con versión remota.
3. Autenticación y usuarios reales; `recordedBy`/`identifiedBy` desde el equipo.
4. Parseo de EXIF y subida diferida de fotos (son lo pesado de la cola).

**Etapa 3 — calidad del dato**
5. Ampliar el catálogo con los campos de conservación (RCE, decreto, endemismo,
   origen, migración) desde una fuente oficial.
6. Resolver las 21 ambigüedades de nombre común y las 16 sinonimias (E1, E2) con
   un criterio taxonómico acordado.
7. Panel de revisión en gabinete: re-identificación con trazabilidad.
8. Medir la precisión del parser sobre los `verbatimUtterance` acumulados.

**Etapa 4 — escala**
9. Metodologías adicionales: atropellos, colisiones, electrocución, rescate,
   seguimiento de individuos, puntos de conteo.
10. Ingesta de cámaras trampa y acústica (lotes de archivos con metadatos).
11. Multi-organización y permisos por proyecto.

## I.4 Cómo probarlo

```bash
cd app
npm install
npm test          # 240 pruebas
npm run dev       # http://localhost:5173
```

Los catálogos de arranque se siembran solos en la primera apertura. Prueba en el campo de
texto (o con el micrófono, en un navegador con permiso):

```
LDB de fauna diaria, EMF01, chucao, 1 sonido
Tres rayaditos, picaflor chico macho, una loica alimentándose
Dos tiuques volando hacia el norte, altura veinte metros
Encontré fecas de puma
Un ratón
creo que un cóndor volando
un lagarto de zapallar
iniciar track
punto 100
cerrar track
un chucao a veinte metros
sin registros en EMF01
una lagartija
```

Para regenerar las semillas desde tus propios CSV:

```bash
python3 tools/construir_catalogo.py      # CSV propios → semillas JSON
python3 tools/cargar_conservacion.py <lista-oficial.csv>   # capa de conservación
```
