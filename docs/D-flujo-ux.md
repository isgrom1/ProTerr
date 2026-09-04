# D. Flujo de usuario

## D.1 El camino corto

```
        hablar  ──►  interpretar  ──►  confirmar  ──►  guardar
        (1 toque)      (automático)     (0-2 toques)    (1 toque)
```

Dos toques y una frase para un registro completo. El formulario existe, pero
detrás de «Editar detalle»: es la excepción, no el camino.

**La jornada normal no abre ni cierra nada:**

```
"EMF01, chucao, vocalización"      → guardado, 08:31
"dos rayaditos"                     → guardado, 08:44
"picaflor chico macho"              → guardado, 08:52
"EMF02, chucao, vocalización"       → guardado, 09:14   ← cambia de estación y sigue
"fecas de puma"                     → guardado, 09:20
```

Cada registro guarda **su propia hora**. No hay muestreo que cerrar, ni
duración, ni distancia: la app no mide esfuerzo salvo que se lo pidan.

Medir el recorrido es una decisión aparte, con sus propios comandos:

```
"iniciar track"  →  "punto 100"  →  "punto 200"  →  "cerrar track"
```

Recién ahí el GPS graba y aparece el panel de track. Al cerrarlo, la pantalla
vuelve a apagarse sola y el GPS se detiene.

## D.2 Pantalla principal (Modo terreno)

```
┌────────────────────────────────────────┐
│ ProTerr                    ● al día    │
├────────────────────────────────────────┤
│ CONTEXTO                               │
│ Proyecto   [ Proyecto demo       ▼ ]   │
│ Campaña [ Invierno ▼ ] Metodol.[ ▼ ]   │
│ Estación   [ EMF01               ▼ ]   │
│ GPS ±8 m · UTM 19S 251144/6538885      │
│                                        │
│ ┌──── Estación detectada: EMF01 ────┐  │   ← sólo si el GPS
│ │  [Confirmar]  [Seleccionar otra]  │  │     sugiere algo y el
│ └───────────────────────────────────┘  │     usuario no confirmó
│                                        │
│ ╔══════════════════════════════════╗   │
│ ║              🎙️                  ║   │   ← 128 px de alto,
│ ║   REGISTRAR OBSERVACIÓN          ║   │     alcanzable con
│ ║   "Chucao, uno, vocalización"    ║   │     el pulgar
│ ╚══════════════════════════════════╝   │
│ [ …o escríbelo aquí ]  [Interpretar]   │
│ [Registro manual]     [Actualizar GPS] │
│                                        │
│ ÚLTIMOS REGISTROS (3 hoy)              │
│ 08:31  Chucao        Vocalización  ●   │
│ 08:44  Rayadito      Individuo ×3  ●   │
│ 09:02  Picaflor…     Individuo     ●   │
│ ⚠️ 3 registro(s) sin sincronizar        │
├────────────────────────────────────────┤
│ 🎙️Terreno ✅Confirmar 📋Registros …     │
└────────────────────────────────────────┘
```

## D.3 Confirmación

Una tarjeta por observación. Lo que falta del **muestreo** (clima, observador)
aparece **una sola vez** arriba; lo de la **observación** va en su tarjeta. Dictar
tres especies no genera tres veces la misma advertencia.

```
NUEVAS OBSERVACIONES (3)
Dictado: "Tres rayaditos, picaflor chico macho, una loica alimentándose"
│ Sin clima (recomendado).                    ← una vez, no tres
├────────────────────────────────────────────┐
│ 1. Rayadito              [Quitar]          │
│    Aphrastura spinicauda                   │
│    📍EMF01  🕐10:34  👁️Individuo  🔢3       │
│ ┃ Falta tipo de registro.                  │  ← amarillo: pendiente
│ ┃ [Dejar pendiente]                        │
│    [Editar detalle]                        │
├────────────────────────────────────────────┤
│ 2. Picaflor chico …  3. Loica …            │
└────────────────────────────────────────────┘
              [Guardar todo]  [Cancelar]
```

**Preguntas resueltas en un toque** (borde verde), sólo cuando hacen falta:

```
┃ ¿Los 5 individuos son macho?
┃ [Sí, todos] [Sólo uno] [Indeterminado]

┃ "matuasto" corresponde a más de una especie. ¿Cuál registraste?
┃ [Matuasto — Phymaturus palluma] [Matuasto — Phymaturus vociferator] …

┃ Escuché "chukao". ¿Es Chucao?
┃ [Sí, Chucao] [No, corregir]
```

Resolver un plural (`rayaditos` → `Rayadito`) **no** genera pregunta: es
gramática, no una duda.

## D.3b Cuándo se pide un punto GPS

No por cada avistamiento. Sólo donde la ubicación significa algo y se queda
quieta: reptiles y anfibios, roedores, evidencia indirecta (fecas, huellas,
madrigueras) y especies en categoría de conservación. Un ave en su estación no
necesita punto propio, y la app no lo pide.

Cuando lo pide, dice por qué:

```
┃ Falta coordenadas del avistamiento (especie de baja movilidad).
┃ [Dejar pendiente]

┃ Falta coordenadas del avistamiento (fecas: la evidencia queda en un punto fijo).
┃ [Dejar pendiente]
```

## D.4 Los cuatro colores del recordatorio

| Color | Severidad | Qué significa | ¿Impide guardar? |
|---|---|---|---|
| 🔴 rojo | `blocker` | No hay especie ni texto: no hay registro | **Sí**, único caso |
| 🟡 amarillo | `pending` | Falta un campo obligatorio del perfil | No — se guarda y queda pendiente |
| 🟢 verde | `question` | Hay que aclarar algo para no inventarlo | No |
| ⚪ gris | `info` | Campo recomendado ausente | No — se menciona y no insiste |

## D.5 Revisión y corrección

`Registros` agrupa por fecha, con filtro «Sólo con información pendiente».
Al abrir un registro: editar abundancia/comportamiento/observaciones,
**Duplicar** (§18) y **Eliminar** (lógico, con auditoría).

## D.6 Cierre de jornada

`Resumen`: estaciones, registros y especies del día; pendientes (revisión, sin
foto, sin abundancia); estado de sincronización con semáforo; y los tres botones
de exportación.

## D.7 Voz en contexto

`¿Qué me falta?`, `Nuevo registro`, `Cambiar estación a EMF10`, `Guardar`,
`Duplicar`, `Revisar pendientes`, `Resumen`, `Sincronizar`, `Agregar foto`,
`Agregar otro individuo`, `Editar abundancia N`, `Sin detecciones`,
`Iniciar track`, `Punto 100`, `Marcar punto medio`, `Cerrar track`,
`Otro igual`, `Otros 3 iguales`, `Deshacer`, `Corrige, eran dos`.

**Todo lo que se puede decir se puede tocar.** En terreno a veces no se puede
hablar —viento, ruido, ir acompañado— o el micrófono simplemente no engancha:
deshacer, repetir y marcar puntos tienen su botón en pantalla.

Se interpretan **antes** que una observación, y sólo si la frase **es** el comando
completo: «cambiar estación a EMF10 y un chucao» se trata como dictado, para no
perder la observación.

## D.8 Decisiones de interfaz para terreno

- Objetivo táctil mínimo **56 px**; el micrófono ocupa 128 px.
- **Modo oscuro por defecto**: se muestrea al amanecer y al atardecer. El tema
  claro existe y respeta la preferencia del sistema.
- Todo alcanzable con **una mano**: navegación abajo, acción principal al centro.
- **Retroalimentación sonora** al iniciar y al fallar el dictado: en terreno no
  siempre se mira la pantalla.
- **Mínimo texto tecleado**: los 17 campos de ingreso manual salen del dictado o
  de listas; sólo «Observaciones» es texto libre.
