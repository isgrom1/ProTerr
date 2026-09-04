# F. Estrategia offline y sincronización

## F.1 Regla

**La red nunca participa del guardado.** Un registro se escribe en IndexedDB
antes de existir en ningún servidor. La sincronización es un proceso posterior,
idempotente y opcional.

## F.2 Antes de salir a terreno

`Ajustes → Actualizar catálogos` descarga y deja en IndexedDB: proyectos,
campañas, estaciones con sus subtablas, el catálogo de especies con su índice de
búsqueda, 11 vocabularios y los perfiles de requisitos.

El *shell* de la app lo cachea un service worker (`app/public/sw.js`):
precarga en la instalación y luego *stale-while-revalidate*, así que ProTerr
abre sin señal. Los datos de terreno **no** pasan por esa caché: viven en
IndexedDB.

Arranque medido: 308 kB de JavaScript (100 kB comprimido). El catálogo (520 kB)
y la librería de Excel (424 kB) se cargan aparte y sólo cuando se necesitan, para
que la pantalla que se usa con el celular en la mano no pague ese costo.

## F.3 En terreno

- Registros a IndexedDB **inmediatamente** al confirmar.
- GPS y cámara siguen funcionando: son del dispositivo.
- Reconocimiento de voz del sistema, sin red (ver [G](G-estrategia-voz.md)).
- Cada cambio encola un `OutboxItem` con id `<entidad>:<uuid>` — reencolar el
  mismo cambio lo **reemplaza**, no lo duplica.

## F.4 Al volver la conexión

```
syncOutbox(transport)
  1. si no hay red → no hace nada (0 intentos, nada se pierde)
  2. ordena: eventos primero        (una ocurrencia sin su evento no tiene sentido)
  3. por cada ítem vencido:
       ok        → borra de la cola, marca 🟢 sincronizado
       conflict  → guarda la versión remota aparte, marca 🔴, NO sobrescribe
       retry     → espera creciente 2s, 4s, 8s … máx 15 min, hasta 8 intentos
       error     → marca 🔴 y espera intervención
  4. todo queda en syncLog: entidad, intento, resultado, mensaje
```

**Estados visibles**: 🟢 sincronizado · 🟡 pendiente · 🔴 error/conflicto.

## F.5 Conflictos

Nunca se sobrescribe en silencio. Ante `409`, la versión remota se guarda en
`settings` bajo `conflict:<entidad>:<uuid>`, el registro local queda intacto y
marcado en rojo, y una persona decide. `Reintentar fallidos` reencola.

## F.6 Sin pérdida ni duplicación

| Riesgo | Mitigación |
|---|---|
| Cierre de la app a mitad de registro | El borrador se confirma o se descarta; lo confirmado ya está en disco |
| Subida duplicada | UUID generado en el dispositivo + `PUT` idempotente por id |
| Dos equipos con la misma planilla | UUID globales; `occurrenceID` incluye el proyecto (resuelve P6) |
| Servidor caído | Espera creciente + reintento manual; nada sale de la cola sin confirmación |
| Sobrescritura de un cambio ajeno | Detección por `revision` → conflicto explícito |
| Borrado accidental | Borrado lógico (`deletedAt`) + entrada de auditoría |
| Contenedor/dispositivo perdido | **Respaldo local completo** (`Resumen → Crear respaldo`): un JSON con registros, esfuerzo, auditoría, cola y fotos. La exportación a Excel no sirve de respaldo porque pierde todo eso |
| Restauración que pisa trabajo nuevo | La fusión conserva la versión local y reporta el conflicto; sobrescribir requiere elegir «reemplazar» a propósito |

## F.7 Contrato con el backend

Deliberadamente mínimo (`SyncTransport` en `app/src/sync/engine.ts`):

```
PUT /<entidad>/<uuid>     body: la entidad completa
  200/204 → aceptado
  409     → conflicto; body = versión remota, con su `revision`
  5xx     → reintentable
  4xx     → error permanente, requiere intervención
```

Cualquier implementación que cumpla esto sirve. Sin servidor configurado la app
opera 100 % local y lo dice explícitamente en la pantalla de Resumen.

## F.8 Verificación

`app/src/db/repository.test.ts` cubre: sin conexión no se toca la cola, la cola se
vacía y marca sincronizado, los reintentos tienen espera creciente sin perder el
registro, un conflicto no sobrescribe la versión local, y los eventos suben antes
que las ocurrencias.
