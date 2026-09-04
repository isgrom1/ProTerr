# A. Punto de partida y decisiones de origen

## A.1 De dónde viene el diseño

ProTerr nació de revisar cómo se registra fauna hoy en terreno: planillas Excel
por proyecto, llenadas a mano o en el celular, con la estructura que cada
consultora fue armando con los años.

Ese trabajo de revisión dejó una lista de problemas recurrentes. **No se
reproduce aquí la estructura de ninguna planilla concreta ni se distribuye
ninguna**: lo que sigue son los patrones que se repiten en el rubro y las
decisiones que ProTerr toma frente a cada uno.

## A.2 Problemas recurrentes de la planilla como herramienta

| # | Patrón | Por qué falla |
|---|---|---|
| P1 | **Llaves de texto libre.** La estación y la especie se escriben a mano y las demás columnas se derivan con `INDEX/MATCH`. | `MATCH` distingue mayúsculas: «Lagarto de zapallar» no calza con «Lagarto de Zapallar» y arrastra `#N/A` por nueve columnas derivadas. |
| P2 | **Nombres comunes duplicados.** Varias especies comparten nombre vulgar. | `MATCH` devuelve **siempre el primero**: asigna la especie equivocada en silencio, sin que nadie lo note. |
| P3 | **Vocabularios latinos y españoles mezclados.** `Mamíferos` junto a `Mammalia`. | Rompe cualquier agrupación y la exportación a Darwin Core. |
| P4 | **Filas planas con el contexto repetido.** Cada observación repite proyecto, región, estación, coordenadas y banderas de metodología. | Un cambio hay que hacerlo en cientos de filas; y ~⅔ de las columnas son derivables, no información nueva. |
| P5 | **`0`, `-` y vacío como «sin dato», indistintamente.** | No se puede saber si una abundancia de 0 es un cero real o una celda sin llenar. |
| P6 | **Sin identificador por registro.** El «N°» es un correlativo por hoja. | Dos equipos no pueden fusionar sus planillas sin colisión. |
| P7 | **Coordenadas UTM sin huso ni datum por fila.** El huso se anota suelto en la cabecera. | La coordenada no es interpretable fuera de su archivo. |
| P8 | **Campos Darwin Core declarados y nunca llenados.** | La compatibilidad queda como intención, no como dato. |
| P9 | **Cientos de filas preformateadas vacías.** Las fórmulas se evalúan sobre filas sin datos. | El archivo pesa de más y genera `#N/A` que viajan al entregable. |
| P10 | **Vocabulario libre donde debería ser cerrado.** Sexo, estado de desarrollo, comportamiento y clima sin lista de validación. | «Escondido» y «Escondidos» son dos categorías distintas al agrupar. |
| P11 | **Subtablas mezcladas en la misma grilla.** Estaciones, puntos de playback, cámaras y líneas de trampeo conviven en una sola hoja. | Las subtablas quedan ligadas por una etiqueta de texto, no por referencia. |
| P12 | **Sin esfuerzo de muestreo.** No se registra cuánto se recorrió ni cuánto tiempo. | Una abundancia no se puede comparar entre campañas. |
| P13 | **Sin ausencias.** Sólo se anota lo que se vio. | La campaña queda sesgada a presencias; no se puede calcular ocupación. |
| P14 | **Sin confianza de identificación.** «Creo que era un chercán» se guarda igual que una certeza. | El error más caro de una línea base, y el único que nadie puede detectar después. |
| P15 | **Sin trazabilidad.** No se sabe quién anotó qué, cuándo, ni qué se corrigió. | Ante una observación del revisor, no hay a qué volver. |

## A.3 Qué toma ProTerr de ahí, y qué no

**Toma la lógica de negocio**, que es conocimiento del rubro y no propiedad de
nadie: que la evidencia se clasifica en directa e indirecta, que las fecas y las
huellas no son individuos, que la estación agrupa el contexto del muestreo, que
las metodologías determinan qué campos tienen sentido.

**No toma ningún archivo, estructura ni catálogo de terceros.** En concreto:

- El **catálogo de especies** de arranque se escribió para este proyecto
  (`data/catalogo/catalogo-base-chile.csv`): nombre común, nombre científico y
  clasificación, que son hechos científicos de dominio público. Son ~156
  especies chilenas de registro corriente, más 8 comodines de grupo. No es una
  lista exhaustiva: es un punto de partida, y cada organización carga la suya.
- Las **estaciones** que trae la app son de demostración y ficticias
  (`data/catalogo/estaciones-demo.csv`). No corresponden a ningún proyecto real.
- El **formato de salida** es propio (`NATIVE_TEMPLATE`). El de cada consultora
  lo aporta esa consultora subiendo su formulario; ver
  [K. Plantillas por consultora](K-plantillas.md).
- La **capa de conservación** se carga desde la lista oficial del organismo
  competente; el archivo que se entrega es un ejemplo marcado como tal.

## A.4 Cada problema y su respuesta

| Patrón | Decisión en ProTerr | Dónde |
|---|---|---|
| P1 llaves frágiles | Búsqueda por claves plegadas (sin acentos ni mayúsculas); el literal exacto se guarda aparte para la exportación | `nlp/taxonIndex.ts` |
| P2 nombres duplicados | `ambiguousCommonName`: la app **pregunta**, nunca toma el primero | `validation/engine.ts` |
| P3 vocabularios mezclados | `class` en latín para Darwin Core, `classEs` en español para el Excel | `domain/types.ts` |
| P4 filas planas | Estrella Event → Occurrence: el contexto se escribe una vez | [B](B-modelo-datos.md) |
| P5 «sin dato» ambiguo | Todo ausente es `null`; `individualCount: null` es un valor legítimo | `domain/types.ts` |
| P6 sin identidad | UUID v4 generado en el dispositivo; `occurrenceID` incluye el proyecto | `db/ids.ts` |
| P7 UTM sin huso | Se guarda lat/lon siempre; huso y datum explícitos por proyecto | `geo/utm.ts` |
| P8 Darwin Core vacío | Los identificadores se generan al crear el registro | [E](E-darwin-core.md) |
| P9 filas fantasma | No existen: la base guarda registros, no filas preformateadas | — |
| P10 vocabulario libre | Listas cerradas descargables y editables como datos | `data/seed/vocabularies.json` |
| P11 subtablas mezcladas | `StationSite` como entidad propia con su tipo | `domain/types.ts` |
| P12 sin esfuerzo | Track explícito con waypoints, opcional | [J.1](J-aristas-adicionales.md) |
| P13 sin ausencias | `noDetections` → `occurrenceStatus=absent` | [J.2](J-aristas-adicionales.md) |
| P14 sin confianza | `seguro` / `probable` / `posible` → `identificationQualifier` | [J.3](J-aristas-adicionales.md) |
| P15 sin trazabilidad | Auditoría campo a campo, borrado lógico, dictado original | `db/repository.ts` |

## A.5 Compatibilidad, sin dependencia

ProTerr **lee y escribe** el formulario de cualquier consultora, pero no lleva
ninguno incorporado. El mecanismo es el mismo en las dos direcciones: un
catálogo de campos con sus alias (`export/fields.ts`) reconoce los encabezados
de una planilla ajena y los empareja con el modelo interno.

- Para **exportar**: se sube el formulario y ProTerr aprende su forma.
- Para **importar** datos históricos: el mismo reconocimiento lee las columnas.

Ver [K. Plantillas por consultora](K-plantillas.md).
