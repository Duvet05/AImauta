# Revisión de arquitectura y seguridad — AImauta

- **Fecha:** 2026-07-25
- **Alcance:** todo el árbol de la aplicación (`app/`, `lib/`, `services/`, `prisma/`, `infra/`, `docs/`, CI).
- **Método:** lectura de código y trazado de flujos (revisión asistida por IA). No hubo pruebas dinámicas contra un entorno desplegado.
- **Naturaleza del sistema:** plataforma educativa para **menores de edad**. La exposición de PII es el eje de riesgo.

> ✅ **Estado de remediación (2026-07-25).** Los hallazgos 🔴 críticos se **mitigan en el mismo cambio que introduce este documento**: un `middleware.ts` cierra el CRUD del directorio detrás de un bearer de admin (fail-closed). Publicar esta revisión ya no expone un hueco abierto. Los hallazgos 🟡/🟢 restantes siguen pendientes (ver hoja de ruta).

---

## Resumen ejecutivo

AImauta combina dos subsistemas de madurez opuesta:

- Un **motor pedagógico robusto** (tutor socrático + pipeline de ejercicios) con defensas fail-closed, contratos de salida cerrados, integridad verificada por request y revisión humana. **Sólido.**
- Una **capa de directorio escolar nueva** (Prisma/PostgreSQL) **completamente sin autenticar**, que expone y permite destruir PII de menores. **Crítico.**

Además, el `docs/ARCHITECTURE.md` ya no describe el sistema real: omite la capa de datos, el subsistema de ejercicios y una segunda dependencia de IA en la nube.

### Índice de hallazgos

| ID | Severidad | Área | Estado |
| --- | --- | --- | --- |
| CRIT-1 | 🔴 Crítico | CRUD del directorio sin autenticación (25/25 métodos) | ✅ Mitigado (gate admin) |
| CRIT-2 | 🔴 Crítico | Borrado en cascada anónimo y destructivo | ◐ Parcial (ya no anónimo) |
| HIGH-1 | 🟠 Alto | Exfiltración/enumeración de PII de menores | ✅ Mitigado (gate admin) |
| MED-1 | 🟡 Medio | Egress de contenido a Google Cloud no documentado | Abierto |
| MED-2 | 🟡 Medio | Estado single-instance (anti-replay y rate-limit en memoria) | Conocido/documentado |
| MED-3 | 🟡 Medio | Rate-limit depende del saneo de `X-Forwarded-For` por el borde | Abierto |
| MED-4 | 🟡 Medio | Falta CSP; HSTS sin `includeSubDomains`/`preload` | Abierto |
| MED-5 | 🟡 Medio | CI sin secret-scanning/SAST/dependency-review | Abierto |
| MED-6 | 🟡 Medio | Nombres sin sanitizar → XSS almacenado potencial | Abierto |
| LOW-1 | 🟢 Bajo | `/api/health` solo liveness | Abierto |
| LOW-2 | 🟢 Bajo | Ruta PDF abre sin `O_NOFOLLOW` (asimetría de hardening) | Abierto |
| LOW-3 | 🟢 Bajo | Oráculo de enumeración por código `409` | Abierto |
| DOC-1 | ℹ️ Doc | `ARCHITECTURE.md` desactualizado respecto al código | Abierto |
| DOC-2 | ℹ️ Doc | La RAG léxica documentada no está cableada al tutor | Abierto |

---

## Estado de remediación

Este cambio incluye la primera corrección (P0):

- **`middleware.ts`** — gate de autenticación sobre `/api/{students,teachers,courses,grades,levels}/*`. Exige `Authorization: Bearer <AIMAUTA_ADMIN_SECRET>`, compara en tiempo constante (HMAC doble, apto para Edge y Node) y **falla cerrado**: sin secreto o secreto `<32` chars → `503`; sin bearer o inválido → `401`. Punto único de enforcement, cubre rutas futuras del directorio.
- Cierra **CRIT-1** y **HIGH-1** (ya no hay acceso anónimo a PII de menores) y de-anonimiza **CRIT-2** (los `DELETE` en cascada quedan detrás del gate; falta añadir confirmación/soft-delete).
- **Interino:** es un bearer de admin único, no roles por usuario. El siguiente paso es autenticación por usuario con rol docente/admin.
- Requiere fijar `AIMAUTA_ADMIN_SECRET` (32+ chars) en el entorno de despliegue; el cliente admin debe enviar el bearer.

---

## Hallazgos críticos

### CRIT-1 — CRUD del directorio escolar sin autenticación

Las rutas `students`, `teachers`, `courses`, `grades`, `levels` (y sus subrutas `[id]`) exponen **GET/POST/PATCH/DELETE sin autenticación, autorización por rol, sesión ni rate-limit**. Verificado ruta por ruta: los 25 métodos están abiertos.

- **Evidencia:** no existe `middleware.ts` (raíz ni `src/`); no hay librería de auth en `package.json`; `lib/rate-limit.ts` solo se importa en `tutor`/`session`/`livekit/token`/`internal/turn`. Ejemplos: `app/api/students/route.ts:21,84`, `app/api/students/[id]/route.ts:48,118`, `app/api/courses/[id]/route.ts:118`.
- **Impacto:** cualquier cliente anónimo lee, crea, modifica y borra registros del directorio.
- **Remediación:** `middleware.ts` que exija sesión autenticada + rol (docente/admin) sobre todo `/api` que no sea de tutoría anónima; aplicar `rate-limit` a estas rutas.

### CRIT-2 — Borrado en cascada anónimo y destructivo

Un único `DELETE` no autenticado de un `Level`/`Grade`/`Course`/`Student` propaga borrados en cascada a todos los hijos, incluyendo **notas (`Evaluation`) y feedback docente (`ProgressNote`)**, y responde `204` sin confirmación ni *soft-delete*.

- **Evidencia:** relaciones `onDelete: Cascade` en `prisma/schema.prisma:29,43,84,85,108,146,147`; endpoints `app/api/levels/[id]/route.ts:59`, `grades/[id]/route.ts:71`, `courses/[id]/route.ts:118`, `students/[id]/route.ts:124`, `teachers/[id]/route.ts:87`.
- **Nota:** `Evaluation` y `ProgressNote` **no son legibles** por ninguna ruta (no hay GET), pero **sí destruibles** por cascada.
- **Impacto:** destrucción total del expediente académico con una sola petición.
- **Remediación:** autenticación (CRIT-1) + confirmación explícita o *soft-delete*; restringir `DELETE` a admin.

---

## Hallazgos altos

### HIGH-1 — Exfiltración y enumeración de PII de menores

Con el CRUD abierto (CRIT-1), la PII de menores es exfiltrable y enumerable.

- **Evidencia:** `Student.firstName/lastName/email` y `Teacher` equivalentes en `prisma/schema.prisma:51-72`; `GET /api/students` pagina la lista con datos personales (`app/api/students/route.ts:57-78`); `GET /api/courses/[id]` incluye `enrollments.student` completo → expone el listado de una clase (`app/api/courses/[id]/route.ts:32-38`); búsqueda exacta por `email` (`app/api/students/route.ts:32`).
- **Mitigación existente:** la paginación topa en 100 (`lib/http.ts:133,142`), así que no hay volcado ilimitado por petición única; pero `page` no tiene cota superior y no hay rate-limit.
- **Remediación:** autenticación por rol (CRIT-1); minimizar campos en las respuestas de listado; rate-limit; considerar cifrado/seudonimización del correo.

---

## Hallazgos medios

### MED-1 — Egress de contenido a Google Cloud no documentado
La ingesta de ejercicios envía **imágenes de páginas del PDF** a la API cloud de Google (`generativelanguage.googleapis.com`, modelo `gemma-4-26b-a4b-it`) con una API key. Es un proceso offline con opt-in, pero constituye una **segunda dependencia de IA externa** no descrita en `ARCHITECTURE.md`, que afirma que Gemma corre solo local en Aule.
- **Evidencia:** `lib/gemma-ingest.ts:4-7,910-916`; `scripts/ingest-exercises.ts` (flujo `detect`/`solve`).
- **Remediación:** documentar la frontera de confianza, la retención y el consentimiento; separarlo claramente del Gemma local del tutor.

### MED-2 — Estado single-instance (anti-replay y rate-limit en memoria)
El registro anti-replay de sesiones y los límites de admisión viven en memoria del proceso: se pierden al reiniciar y no coordinan entre réplicas. Escalar horizontalmente **rompe el enforcement en silencio**.
- **Evidencia:** `lib/learning-session.ts` (registro de revisiones en memoria); `lib/rate-limit.ts:27-30`. Documentado como limitación conocida en `ARCHITECTURE.md`.
- **Remediación:** mover a un store compartido (PostgreSQL/Redis) antes de cualquier escalado.

### MED-3 — El rate-limit depende del saneo de `X-Forwarded-For` en el borde
La integridad del límite por cliente asume que Tailscale Funnel/nginx sobrescriben `X-Forwarded-For`. nginx usa la XFF entrante con un regex laxo como clave; el limitador de app solo confía en ella con `AIMAUTA_TRUST_PROXY_HEADERS=true`.
- **Evidencia:** `infra/web/nginx.conf:19-22,117,120-121`; `lib/rate-limit.ts:92-111`.
- **Impacto:** si el 3308/3309 quedara expuesto directamente, un atacante falsifica XFF y rota buckets → bypass del rate-limit.
- **Remediación:** documentar y forzar que Funnel es el **único** ingreso; que nginx reescriba XFF con su valor canónico.

### MED-4 — Falta Content-Security-Policy; HSTS parcial
No hay cabecera CSP en `next.config.ts` ni en nginx; HSTS sin `includeSubDomains`/`preload`.
- **Evidencia:** `next.config.ts:22-45`; `infra/web/nginx.conf:57-62`.
- **Remediación:** añadir CSP restrictiva y endurecer HSTS. Reduce el impacto de un eventual XSS (ver MED-6).

### MED-5 — CI sin escaneo de secretos, SAST ni dependency-review
El CI es completo (catalog:validate, typecheck, lint, vitest, build, pytest del worker, smoke de LiveKit, acciones pinneadas por SHA), pero falta: secret-scanning, SAST/CodeQL, dependency-review; `npm audit` solo bloquea `high` y omite devDeps; no corre `exercises:validate`.
- **Evidencia:** `.github/workflows/ci.yml` (job único `validate`, `:46-47`).
- **Remediación:** añadir gitleaks + dependency-review + SAST; bajar `npm audit` a `moderate`; incluir `exercises:validate`.

### MED-6 — Nombres sin sanitizar → XSS almacenado potencial
`firstName`/`lastName` aceptan cualquier carácter (incl. HTML) hasta 100 chars y se almacenan crudos. Si un futuro panel docente/admin los renderiza sin escapar, hay XSS almacenado.
- **Evidencia:** `lib/http.ts:65-81`. (SQL injection **no aplica**: todo va por queries parametrizadas de Prisma.)
- **Remediación:** escapar en el render (obligatorio) y considerar validación de conjunto de caracteres en el ingreso; combinar con CSP (MED-4).

---

## Hallazgos bajos

- **LOW-1 — `/api/health` es solo liveness.** Devuelve `{status:"ok"}` sin chequear BD/Ollama/LiveKit → puede reportar sano con dependencias caídas. `app/api/health/route.ts:4-12`. *(Positivo: no filtra información.)*
- **LOW-2 — Ruta PDF sin `O_NOFOLLOW`.** `app/api/materials/[bookId]/pdf/route.ts:47` abre sin `O_NOFOLLOW`, a diferencia de los stores (`lib/exercise-store.ts:186`). No alcanzable por el cliente; asimetría de defensa-en-profundidad.
- **LOW-3 — Oráculo de enumeración por `409`.** `lib/http.ts:27-33` mapea `P2002` a un `409` distinguible → confirma existencia de un email. Redundante con HIGH-1 pero persiste aunque se restrinja el GET.

---

## Divergencias documentación ↔ código

- **DOC-1 —** `ARCHITECTURE.md` omite: la capa Prisma/PostgreSQL y su PII; todo el subsistema de ejercicios y su ruta `GET /api/materials/:bookId/exercises`; el egress a Google (MED-1); la re-verificación de integridad SHA-256 por request de la ruta PDF (`lib/file-integrity.ts`).
- **DOC-2 —** La "RAG léxica por página con ventana de ±2" que describe el doc (`ARCHITECTURE.md`, sección Contenido/RAG) **no está cableada al tutor**: `retrieveEvidence`/`rankChunks` (`lib/retrieval.ts`) solo se referencian en `tests/`. El turno real usa `retrieveExerciseEvidence` (evidencia derivada del ejercicio). Decidir: cablearla o retirarla del doc.
- **Dos fuentes de verdad —** el catálogo vive en `/config` y se copia crudo a `ConfigSnapshot` en BD; la app sigue leyendo los archivos → posible drift. `Evaluation.unitId` es string suelto, no FK (decisión deliberada, documentar).

---

## Fortalezas confirmadas (preservar)

- **Tutor:** guard de salida cerrado — Gemma elige **1 de 5 etiquetas**; cualquier desviación se descarta y cae a plantilla determinista (`lib/pedagogy.ts:90-124`, `lib/tutor-service.ts:195-211`). HMAC-SHA-256 con `timingSafeEqual` y anti-replay monotónico (`lib/learning-session.ts:148,305-310,238-249`). Auth interna fail-closed con comparación en tiempo constante (`lib/internal-auth.ts:11-30`). Timeout + respaldo determinista real ante caída de Ollama (`lib/ollama.ts:36,55-57`; `lib/tutor-service.ts:188-211`). Exclusión de `Evaluamos`/`teacherOnly`.
- **Ejercicios:** separación pública/privada estricta (soluciones en mount aparte, `O_NOFOLLOW`), integridad **re-verificada por request** y fail-closed (`lib/file-integrity.ts:130`), release en dos fases con lock y rollback, **revisión humana obligatoria**. Sin fuga de soluciones ni path-traversal explotable.
- **Config/flags/ops:** flags fail-closed con el servidor como autoridad sobre `?avatar=1` (`lib/feature-flags.ts`, `app/api/livekit/token/route.ts:24`); sin defaults inseguros; contenedores read-only/no-root/no-new-privileges; imágenes pinneadas por digest; ingesta sin superficie HTTP; manejo de errores que no filtra internals (`lib/http.ts:20-46`).

---

## Hoja de ruta de remediación

| Prioridad | Acción | Hallazgos |
| --- | --- | --- |
| P0 | `middleware.ts` con auth + rol + rate-limit sobre el directorio | CRIT-1, HIGH-1 |
| P0 | Confirmación / soft-delete + restricción de `DELETE` a admin | CRIT-2 |
| P1 | Reescribir `ARCHITECTURE.md` (Prisma, ejercicios, egress Google, integridad) | DOC-1, MED-1 |
| P1 | Añadir CSP + endurecer HSTS; readiness real en `/health` | MED-4, LOW-1 |
| P1 | CI: secret-scanning + dependency-review + `exercises:validate`; `audit` a `moderate` | MED-5 |
| P2 | Mover anti-replay + rate-limit a store compartido | MED-2, MED-3 |
| P2 | Escapar/validar nombres; resolver drift `/config`↔`ConfigSnapshot`; cablear o retirar RAG léxica | MED-6, DOC-2 |
