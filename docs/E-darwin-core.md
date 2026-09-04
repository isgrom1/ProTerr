# E. Esquema Darwin Core

Implementado en [`app/src/export/dwca.ts`](../app/src/export/dwca.ts).

Darwin Core no se agregó al final: el modelo interno **es** la estrella Event →
Occurrence, así que la exportación es una proyección directa. Eso resuelve el
patrón P8 de [A](A-punto-de-partida.md): campos Darwin Core declarados en la
planilla y nunca llenados.

## E.1 Estructura del archivo generado

```
ProTerr_DwC-A_2026-09-04.zip
├── meta.xml                  core=Event, extensiones=Occurrence, MeasurementOrFact
├── eml.xml                   metadatos del conjunto
├── event.txt                 un evento por muestreo
├── occurrence.txt            una fila por observación
└── measurementorfact.txt     variables adicionales
```

## E.2 Mapeo de campos

### Event (core)

| Planilla / ProTerr | Término Darwin Core |
|---|---|
| `SamplingEvent.id` | `eventID` |
| Fecha | `eventDate`, `year`, `month`, `day` |
| Hora | `eventTime` |
| Metodología | `samplingProtocol` |
| Esfuerzo (distancia, trampas-noche o minutos) | `sampleSizeValue`, `sampleSizeUnit`, `samplingEffort` |
| Estación | `locationID`, `locality` |
| Coordenadas de estación / dispositivo | `decimalLatitude`, `decimalLongitude` |
| Huso + UTM (P7) | `verbatimCoordinates`, `verbatimCoordinateSystem`, `verbatimSRS` |
| Datum | `geodeticDatum` |
| Precisión GPS | `coordinateUncertaintyInMeters` |
| Región | `stateProvince` (+ `country`=Chile, `countryCode`=CL) |
| Ambiente | `habitat` |
| Muestreado por | `recordedBy` |
| Clima y condiciones (periodo, temperatura, viento, nubosidad) | `eventRemarks` |
| Campaña | `parentEventID` |

### Occurrence (extensión)

| Planilla / ProTerr | Término Darwin Core |
|---|---|
| `Occurrence.occurrenceId` | `occurrenceID` |
| — | `basisOfRecord` (ver E.3) |
| Abundancia | `individualCount`, `organismQuantity`, `organismQuantityType` |
| Sexo | `sex` |
| Estado desarrollo | `lifeStage` |
| Comportamiento | `behavior` |
| Estado del organismo | `vitality` |
| Tipo de registro | `occurrenceRemarks` (`tipoRegistro=…`, `evidencia=…`) |
| Fotos | `associatedMedia` |
| Coordenadas del avistamiento | `decimalLatitude/Longitude` propios |
| Nombre científico | `scientificName` |
| Nombre común | `vernacularName` |
| Reino…Epíteto infraespecífico | `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `specificEpithet`, `infraspecificEpithet` |
| Rango | `taxonRank` |
| Confianza: probable / posible / comodín | `identificationQualifier` = `cf.` / `?` / `sp.` |
| Código del individuo (recaptura) | `organismID` |
| Generalización de coordenadas sensibles | `dataGeneralizations`, `informationWithheld` |

**`class` va en latín** (`Mammalia`, `Amphibia`), resolviendo P3. La forma en
español se conserva en `classEs` y es la que usa la exportación a Excel.

### MeasurementOrFact (extensión)

Todo lo que no tiene término estándar viaja aquí, que es el mecanismo previsto
por Darwin Core para extender sin romper el esquema:

| Medición | Unidad |
|---|---|
| `alturaDeVuelo` | m |
| `categoriaAlturaDeVuelo` | categorías 1-5 de la planilla |
| `direccionDeVuelo`, `origenDeVuelo`, `destinoDeVuelo` | — |
| `respuestaPlayback` | — |
| cualquier variable futura | definida por el proyecto |

## E.3 Decisión sobre `basisOfRecord`

La tentación es mapear `Registro: Individuo, feca, vocalización…` directo a
`basisOfRecord`. **Es incorrecto**: ese término tiene un vocabulario cerrado
(`HumanObservation`, `MachineObservation`, `PreservedSpecimen`, …) y «Fecas» no
está en él. Un archivo con `basisOfRecord=Fecas` es rechazado por GBIF.

ProTerr usa:
- `MachineObservation` para cámara trampa y songmeter,
- `HumanObservation` para el resto,

y lleva el detalle fino a `occurrenceRemarks` y a `MeasurementOrFact`, que es
donde corresponde.

## E.3b Ausencias

Un muestreo realizado sin detecciones se exporta como una ocurrencia con
`occurrenceStatus=absent` e `individualCount=0`, que es la forma en que GBIF
espera una ausencia. Omitirla convertiría la campaña en un sesgo de
sólo-presencias, y con eso no se puede calcular ocupación ni detectar una
disminución entre temporadas.

## E.3c Localidades sensibles

`dataGeneralizations` e `informationWithheld` se llenan al aplicar la política
de coordenadas para especies amenazadas. Ver
[J.5](J-aristas-adicionales.md#j5-localidades-sensibles-al-exportar).

## E.4 Location

No es un archivo separado: los términos de lugar viven en el Event
(`locationID`, `locality`, `decimalLatitude/Longitude`, `geodeticDatum`,
`coordinateUncertaintyInMeters`, `verbatimCoordinates`), que es la forma
canónica en un DwC-A con core de eventos. `StationSite` (punto de playback,
cámara, línea Sherman) se expresa como `locationID` propio del sitio.

## E.5 Identification

Modelada como entidad (`Identification`: `identifiedBy`, `dateIdentified`,
`identificationQualifier`, `identificationRemarks`) para admitir
re-identificación posterior en gabinete — el caso real de un registro dictado
como «ratón sp.» que después se determina a especie. En el archivo exportado se
proyecta sobre los términos correspondientes de Occurrence.

## E.6 Verificación

Cubierta por `app/src/export/export.test.ts`: estructura del archivo, un evento
por muestreo (no uno por observación), `basisOfRecord` dentro del vocabulario,
abundancia vacía en evidencia indirecta y datos de vuelo en MeasurementOrFact.
