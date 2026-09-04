# B. Modelo de datos

Implementado en [`app/src/domain/types.ts`](../app/src/domain/types.ts).

## B.1 Principio

La planilla es **una salida**, no la estructura. El modelo interno es una estrella
Darwin Core; el Excel (con el formato que la organización cargue) y el DwC-A se
generan al exportar.

La consecuencia práctica: **una ocurrencia no copia nada derivable**. Proyecto,
región, ambiente, coordenadas de estación y las 9 columnas taxonómicas no se
guardan en el registro, se resuelven contra el catálogo al exportar. Por eso
corregir hoy la ortografía de una especie corrige también los registros del año
pasado, en vez de dejarlos congelados con un `#N/A` (resuelve E5, E6).

## B.2 Entidades

```
Project ──< Campaign
   │            │
   └──< Station ──< StationSite        (punto PB, cámara, línea Sherman: resuelve P11)
             │
             └──< SamplingEvent  ──< Occurrence ──< Identification
                  (dwc:Event)        (dwc:Occurrence)  ──< MeasurementOrFact
                                                       ──< MediaObject
Taxon  (catálogo, referenciado por Occurrence.taxonId)
AuditEntry / OutboxItem / SyncLogEntry  (transversales)
```

**Un evento, muchas ocurrencias.** Un evento es «estación + metodología + día».
Las decenas de columnas de contexto que una planilla plana repite en cada fila se
escriben **una vez** (resuelve P4). Una jornada de 200 registros en 20 estaciones
pasa de 200 filas de contexto repetido a unos 40 eventos.

## B.3 Decisiones que responden al diagnóstico

| Patrón (ver [A](A-punto-de-partida.md)) | Decisión |
|---|---|
| P2 nombres comunes duplicados | `Taxon.ambiguousCommonName` los marca. Ante ambigüedad la app **pregunta**, nunca elige el primero |
| P3 clase en dos idiomas | `Taxon.class` normalizada a latín (`Mammalia`) para Darwin Core; `Taxon.classEs` conserva la forma de la planilla para el Excel |
| P1 llave sensible a mayúsculas | La búsqueda usa `searchKeys` plegadas (minúsculas, sin acentos, sin puntuación); el literal exacto se conserva aparte para la exportación |
| P10 vocabulario libre | `RecordType`, `Sex`, `LifeStage`, `OrganismCondition` son tipos cerrados; los vocabularios se descargan como datos |
| P5 `0` como "sin dato" | Todo campo ausente es `null`. `individualCount: null` es un valor legítimo y distinto de `0` |
| P8 IDs Darwin Core vacíos | `occurrenceID`, `eventID` y `locationID` se generan al crear el registro, con forma `urn:proterr:<proyecto>:occ:<uuid>` |
| P6 sin identidad | Todo nace con UUID v4 **en el dispositivo**. Dos equipos pueden fusionar sin colisión |
| P7 UTM sin huso | Se guarda lat/lon siempre; `Project.utmZone`, `utmHemisphere` y `geodeticDatum` son explícitos y el UTM se deriva al exportar |

## B.4 Campos que la planilla no tenía y el terreno sí necesita

- **`AttributeScope`** (`todos` / `algunos` / `sin_definir`) en sexo y estado de
  desarrollo. Resuelve el caso «5 individuos, sexo macho»: el atributo queda
  marcado como no resuelto hasta que el usuario aclara a quién aplica.
- **`Occurrence.occurrenceFix` vs `SamplingEvent.deviceFix` vs `Station.utmEast`**:
  tres posiciones distintas que la planilla confundía en una. La del avistamiento,
  la del dispositivo al abrir el muestreo, y la de la estación.
- **`verbatimUtterance`**: el dictado original. Permite auditar la interpretación
  del parser y, más adelante, medir su precisión con datos reales.
- **`pendingFields`**: qué quedó incompleto a propósito. Es lo que hace posible
  guardar sin bloquear (§7 del brief) sin perder de vista lo que falta.
- **`recordTypeInferred` / `countInferred`**: distingue lo que dijo el usuario de
  lo que asumió el sistema. Sin esto, «Un chucao» y «Un chucao, visto» serían
  indistinguibles en la base.
- **`Auditable`**: `createdBy/At`, `updatedBy/At`, `revision`, `deletedAt`,
  `deviceId`, `syncState`. Presente en toda entidad sincronizable.
- **Esfuerzo en el evento**: `startedAt`, `endedAt`, `track`, `distanceMeters`,
  `trapCount`, `trapNights`, `conditions`. Sin esto una abundancia no se puede
  comparar entre campañas, y la planilla no lo registraba en ninguna forma.
- **`noDetections`**: la estación se muestreó y no se detectó fauna. Es un dato
  de ausencia, no una omisión, y se exporta como tal.
- **`identificationConfidence`**: `seguro` / `probable` / `posible`. Guardar
  «creo que era un chercán» como certeza es fabricar un dato.
- **`ConservationStatus`**: capa aparte sobre el catálogo, con su fuente. Lo que
  no viene en la lista oficial queda «sin clasificar», que no es «sin riesgo».
- **`reviewState`**: `terreno` → `revisado` → `validado`, con quién y cuándo.
- **`detectionDistanceMeters`, `organismId`, `recapture`**: densidad por
  *distance sampling* y recaptura en trampeo.

Ver [J. Aristas adicionales](J-aristas-adicionales.md) para el detalle de por
qué cada uno hace falta.

## B.5 Vocabularios

Los 6 de la planilla se conservan textualmente. Se agregan 5 que la planilla usaba
sin declarar (E7): `lifeStage`, `organismCondition`, `sex`, `weather`,
`occurrenceEvidenceKind`. Todos viven en `vocabularies.json`, descargable y
editable sin recompilar.

## B.6 Regla Directo/Indirecto

Se conserva la de la planilla y se le da consecuencias:

```
Individuo, Vocalización                     → Directo   → abundancia por defecto 1
Fecas, Huella, Plumas, Muda, Madriguera,    → Indirecto → abundancia null, y
Cururera, Huesos, Nido, Egagrópila,                       sexo/edad/comportamiento
Registro de audio                                         ocultos
```

Es lo que hace que «fecas de puma» **no** genere `Puma ×1` (brief §25).
