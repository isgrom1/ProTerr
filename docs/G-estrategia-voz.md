# G. Estrategia de voz y lenguaje natural

## G.1 Reconocimiento en el dispositivo

Se usa el motor del propio aparato (Web Speech API en navegador; el reconocedor
del sistema en una app nativa). En Android e iOS funciona **sin conexión** con el
paquete de español descargado.

Por qué no un servicio en la nube: en terreno no hay red, así que un STT remoto
no es una degradación sino un bloqueo. Además evita subir audio de campo a un
tercero.

**Degradación**: si no hay motor de voz o falta el permiso, el campo de texto
sigue ahí y el parser trabaja igual — opera sobre texto, venga de donde venga.
Ninguna funcionalidad depende del micrófono.

## G.2 Del audio al registro

```
audio → transcripción → ¿es un comando? → sí → ejecutar
                             │ no
                             ▼
                      segmentar en fragmentos
                             ▼
             fragmento con taxón → nueva observación
             fragmento sin taxón → atributo del anterior
                                   (o contexto común, si no hay ninguna)
                             ▼
                    extraer campos por léxico
                             ▼
                     validar → tarjeta de confirmación
```

**La idea que hace que funcione sin sintaxis obligatoria**: un fragmento abre una
observación nueva **sólo si nombra una especie**. Por eso

- «Tres rayaditos, picaflor chico macho, una loica alimentándose» → **3 registros**
- «Dos tiuques volando hacia el norte, altura veinte metros» → **1 registro**

sin que el usuario tenga que marcar dónde termina una observación y empieza otra.

## G.3 Por qué reglas y no un modelo de lenguaje

| | Reglas | LLM |
|---|---|---|
| Offline | Sí | Requiere red o un modelo local grande |
| Latencia | < 5 ms | segundos |
| Determinismo | Total: mismo texto, mismo resultado | Variable entre ejecuciones |
| Auditable | El error se ve y se corrige en el léxico | Difícil de explicar y de reproducir |
| Vocabulario cerrado | Es exactamente el caso: un catálogo acotado y listas fijas | Sobra capacidad |

**Límite honesto**: las reglas no manejan frases con estructura inesperada
(subordinadas largas, correcciones a media frase, «no, mejor pon dos»). Para eso
está `verbatimUtterance`: cada dictado queda guardado junto al registro, así que
se puede medir con datos reales dónde falla el parser y decidir después —con
evidencia— si conviene un modelo en la nube para el trabajo de gabinete, donde sí
hay red. La arquitectura no lo impide: `parseUtterance` es una función pura y
reemplazable.

## G.4 Qué reconoce

**Cantidades**: dígitos y palabras 0-9999, incluyendo «veintiuno», «treinta y
dos», «mil doscientos». Los artículos «un/una» cuentan como 1.

**Taxones**: nombre común, nombre científico, abreviatura del género
(`S. rubecula`), plurales y errores menores de escritura. La corrección
ortográfica es una **segunda pasada**: sólo se aplica si ninguna posición del
texto dio coincidencia exacta, para que «dos tiuques» no se resuelva por
parecido antes de llegar a «tiuque», que está bien escrito.

**Ambigüedad**: un nombre común que el catálogo comparte entre varias especies
devuelve todos sus candidatos. La app pregunta; **nunca elige el primero**, que es justo lo que hacía
`INDEX/MATCH`.

**Léxico de campo** (`app/src/nlp/lexicon.ts`, ampliable como dato):
tipo de registro y evidencia, sexo, estado de desarrollo, estado del organismo,
comportamiento, dirección cardinal, metodología (incluido «LDB fauna diaria»
→ transecto), altura de vuelo con y sin unidad.

**Estaciones**: código conocido, o el patrón letras+dígitos aunque el dictado lo
separe («EMF 10» → `EMF10`).

## G.5 Detalles que salieron de probar con frases reales

- **«cantando» es tipo de registro *y* comportamiento**: se asignan ambos, que es
  como se usa en terreno.
- **«este» sólo es rumbo si algo lo introduce** («hacia el este»): si no, es el
  demostrativo. «norte», «sur» y «oeste» no tienen esa ambigüedad.
- **El punto de `S. rubecula` no corta la frase**, ni la coma de «1,5 m».
- **Resolver un plural no es corregir**: `rayaditos` → `Rayadito` no genera
  pregunta. `chukao` → `Chucao` sí.
- **Enumerar grupos de la misma especie es normal.** "Tres loicas vocalizando,
  una loica macho, dos loicas vocalizando" son tres registros distintos, no un
  error de dictado. Los registros de un mismo dictado comparten lote y por eso
  el detector de duplicados nunca los confunde entre sí.
- **«muerto» es estado del organismo, no evidencia indirecta**: un cadáver es un
  individuo observado.

## G.6 Verificación

`app/src/nlp/parser.test.ts` (23 pruebas) cubre los 6 casos del brief, las 8
frases libres del §2, el caso de múltiples observaciones, y las regresiones de
§G.5. `app/src/nlp/commands.test.ts` (12 pruebas) cubre los comandos de voz.
