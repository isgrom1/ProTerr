# H. Validación y recordatorios

Implementado en [`app/src/validation/`](../app/src/validation/).

## H.1 La regla que ordena todo

**Sólo hay un motivo para impedir un guardado: que no haya especie ni texto.**
Todo lo demás se guarda y queda registrado como pendiente. El brief §7 es
explícito y el motor lo respeta literalmente: `canSave` sólo es `false` ante un
`blocker`, y el único `blocker` que existe es ese.

## H.2 Configuración sin código

Un perfil es un objeto JSON con cuatro capas, que se aplican en orden:

```
fields                    requisito base del proyecto
  → overridesByGroup      por grupo taxonómico (aves, mamíferos, …)
    → overridesByMethod   por metodología
      → overridesByRecordType   quien sabe si hubo un animal
        → especie amenazada     sube el listón: foto y coordenada obligatorias
```

La última capa no se configura: si el taxón está en categoría de amenaza, la
fotografía pasa a obligatoria por encima del perfil. Es el registro que más se
va a cuestionar en la revisión, y si falta la evidencia ya no hay forma de
conseguirla.

**El esfuerzo de muestreo no está en esta tabla a propósito.** La app no lo
exige nunca: sólo lo revisa si el usuario activó un track y lo dejó a medias.
Ver [J.1](J-aristas-adicionales.md#j1-esfuerzo-de-muestreo--opcional-nunca-impuesto).

Cuatro niveles por campo: `required` · `recommended` · `optional` · `hidden`.

Se edita desde `Ajustes → Campos requeridos por metodología`, con una matriz
campo × nivel para la metodología elegida. No requiere recompilar (brief §8).

## H.3 Qué pide cada metodología (perfil por defecto)

| Campo | Transecto | Playback | Tránsito aéreo | Cámara trampa | Sherman |
|---|---|---|---|---|---|
| Estación | ● | ● | ● | ● | ● |
| Especie | ● | ● | ● | ● | ● |
| Tipo de registro | ● | ● | ○ | ◐ | ○ |
| Abundancia | ● | ● | ● | ● | ● |
| Hora | ● | ● | ● | ● | ● |
| Observador | ● | ◐ | ◐ | ◐ | ◐ |
| Respuesta al playback | — | ● | — | — | — |
| Dirección de vuelo | — | — | ● | — | — |
| Altura de vuelo | — | — | ● | — | — |
| Origen / destino | — | — | ◐ | — | — |
| Sexo | ○ | ○ | ◐ | ○ | ◐ |
| Fotos | ○ | ○ | ○ | ● | ○ |
| Coordenadas de captura | ○ | ○ | ○ | ○ | ◐ |

● obligatorio · ◐ recomendado · ○ opcional · — no se muestra

Los campos de tránsito aéreo están `hidden` fuera de su metodología: no aparecen
donde no corresponden (brief §27).

## H.4 El tipo de registro manda

`overridesByRecordType` se aplica al final porque es quien sabe si hubo un
animal. Con `Fecas`, `Huella`, `Madriguera`, `Muda`, `Huesos` o `Egagrópila`:

```
individualCount → optional        (no se pide abundancia)
sex, lifeStage, behaviour → hidden (no tienen sentido sobre un signo)
```

Por eso «Fecas de puma» se guarda sin una sola advertencia.

## H.4b La coordenada no se configura: se deduce

`occurrenceCoordinates` es el único campo que ignora el perfil. Pedirlo por cada
ave sería trabajo inútil; no pedirlo en una lagartija sería perder el dato. La
regla vive en `conservation/mobility.ts` y depende de tres cosas:

1. **Movilidad de la especie.** Reptiles, anfibios, roedores y marsupiales: sí.
   Aves y mamíferos grandes: no, la estación ya los ubica.
2. **Tipo de registro.** Fecas, huellas, madrigueras, nidos, plumas y huesos son
   puntos fijos: sí.
3. **Conservación.** Una especie amenazada siempre lleva punto, aunque vuele.

El mismo criterio decide cuándo sugerir fotografía. El aviso siempre dice la
razón, para que el usuario entienda por qué se le pide justo esta vez.

## H.4c El canal de detección decide qué se pregunta

Lo que sólo se sabe viendo al animal no se pide cuando sólo se oyó. Un
avistamiento y una foto de cámara trampa admiten conducta y edad; una
vocalización, una grabación o unas fecas, no. Ver
[J.11](J-aristas-adicionales.md).

## H.5 Lo que nunca se pide

Reino, filo, clase, orden, familia, género, epíteto, origen, distribución,
categoría RCE, decreto, proyecto, región, ambiente, ladera, coordenadas de
estación. **Todo eso se deriva del catálogo.** Hay una prueba que lo verifica
explícitamente: recorre el texto de los recordatorios y falla si aparece alguno
de esos términos.

## H.6 Recordatorios por nivel

Los avisos se marcan como **de muestreo** (`event`) o **de observación**
(`occurrence`). El clima o el observador pertenecen al muestreo: si el usuario
dicta tres especies seguidas, se preguntan **una vez** arriba, no tres veces.
Es la diferencia entre un recordatorio y una molestia.

## H.7 Preguntas de validación inteligente

Aparecen sólo cuando el sistema tendría que **inventar** el dato:

| Situación | Pregunta | Opciones |
|---|---|---|
| `5 individuos` + `macho` | ¿Los 5 individuos son macho? | Sí, todos / Sólo uno / Indeterminado |
| `3 individuos` + `juvenil` | ¿Los 3 individuos son juvenil? | Sí, todos / Sólo algunos / Indeterminado |
| Nombre común ambiguo | «matuasto» corresponde a más de una especie. ¿Cuál registraste? | los candidatos reales del catálogo |
| Corrección ortográfica | Escuché «chukao». ¿Es Chucao? | Sí / No, corregir |
| `Fecas` con abundancia 2 | ¿La abundancia se refiere a individuos o a signos? | Son signos / Mantener |

La respuesta se guarda: `AttributeScope` deja constancia de si el sexo aplicaba a
todos o a algunos, y eso viaja al `occurrenceRemarks` del DwC-A.

## H.8 «¿Qué me falta?»

`whatIsMissing()` devuelve **sólo** lo accionable, ordenado por urgencia
(bloqueos → preguntas → pendientes). Los campos recomendados no entran: si
faltara un recomendado y tres obligatorios, mostrar los cuatro haría que el
usuario deje de leer la lista.

Caso 6 del brief, verificado en pruebas:

```
Entrada:  "Un chucao"  (perfil exige tipo de registro)
Salida:   ["Falta tipo de registro."]     ← exactamente un elemento
```

## H.9 Verificación

`app/src/validation/engine.test.ts` (14 pruebas): perfiles por metodología y por
tipo de registro, no bloqueo, no pedir taxonomía derivable, separación
evento/observación, las cinco preguntas de §H.7 y el caso 6.
