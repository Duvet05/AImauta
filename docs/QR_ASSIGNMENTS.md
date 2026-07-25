# Tareas y códigos QR

## Estado

El backend de tareas QR está implementado sobre PostgreSQL. Permite asignar una
ficha, una página, un ejercicio, un refuerzo o una tarea con varios objetivos;
genera QR en SVG, PNG o PDF; abre la actividad sin cuenta; reanuda una ejecución
anónima; limita la ayuda; agrega progreso y emite un comprobante verificable.

El panel docente y la autenticación personal de docentes todavía no forman
parte de este alcance. Durante el piloto, las rutas administrativas exigen un
Bearer compartido de servidor:

```http
Authorization: Bearer <AIMAUTA_ASSIGNMENT_ADMIN_SECRET>
```

Esta credencial nunca debe incluirse en JavaScript del navegador, una URL, un
QR, WhatsApp o logs. Un backend administrativo de confianza debe custodiarla.

## Modelo de seguridad

- El QR contiene únicamente una URL `/a/:publicToken`. `publicToken` es un
  valor aleatorio de 256 bits y no codifica nombres, notas ni respuestas.
- PostgreSQL guarda el hash SHA-256 del token para resolverlo y una copia
  cifrada con AES-256-GCM únicamente para volver a descargar el QR.
- El inicio de un estudiante emite otro token aleatorio de reanudación. Se
  guarda en el navegador y se envía por `Authorization`; no se coloca en URLs.
- El comprobante usa un tercer token, separado criptográficamente de los dos
  anteriores.
- Las sesiones pedagógicas HMAC incluyen el ID de tarea, ejecución y objetivo,
  las páginas permitidas, el ejercicio fijado y el máximo de ayuda. El servidor
  rechaza navegación fuera de ese alcance.
- Cada objetivo fija el checksum del PDF, versión curricular y revisión del
  ejercicio existentes al crearlo. Si el contenido publicado cambia, el enlace
  falla de forma cerrada y el docente debe crear o revisar una tarea nueva.
- Se persisten estado, marcas de tiempo, cantidad de turnos, cantidad de
  intentos y pista máxima. No se persisten nombres del estudiante, texto del
  intento, conversación, audio ni calificaciones.

Rotar el token público invalida el QR anterior y conserva las ejecuciones ya
iniciadas. Cambiar el estado a `REVOKED` o `ARCHIVED` bloquea tanto nuevos
accesos como reanudaciones.

## Variables de entorno

```dotenv
DATABASE_URL=postgresql://aimauta:...@127.0.0.1:5432/aimauta?schema=public
AIMAUTA_PUBLIC_URL=https://aprende.example.edu
AIMAUTA_ASSIGNMENT_ADMIN_SECRET=<aleatorio independiente de 32+ caracteres>
AIMAUTA_ASSIGNMENT_TOKEN_SECRET=<aleatorio independiente de 32+ caracteres>
AIMAUTA_SESSION_SECRET=<aleatorio independiente de 32+ caracteres>
```

`AIMAUTA_PUBLIC_URL` debe ser el origen HTTPS visible por el estudiante, sin
ruta, query, fragmento ni credenciales. Los dos secretos de tareas deben ser
distintos entre sí. El secreto de tokens cifra material recuperable; rotarlo
sin una migración vuelve indescifrables los QR y comprobantes ya almacenados.

Aplicar la migración antes de iniciar el release:

```bash
npx prisma migrate deploy
```

La prueba integral local o de staging crea un fixture temporal, recorre el flujo
completo y lo elimina al terminar:

```bash
npm run assignments:smoke
```

## Crear una tarea

`POST /api/assignments`

```json
{
  "kind": "TASK",
  "title": "Ficha 3 de Matemática",
  "instructions": "Explica tu estrategia antes de pedir una pista.",
  "teacherId": "cm...",
  "courseId": "cm...",
  "groupLabel": "1.º A",
  "availableFrom": "2026-07-25T18:00:00.000Z",
  "expiresAt": "2026-07-28T03:00:00.000Z",
  "maxHintLevel": 2,
  "minimumTurnsPerItem": 1,
  "requiredItemCount": 2,
  "items": [
    {
      "kind": "PAGE",
      "bookId": "fichas-matematica-1-secundaria",
      "page": 33
    },
    {
      "kind": "EXERCISE",
      "bookId": "fichas-matematica-1-secundaria",
      "exerciseId": "ejercicio-4"
    }
  ]
}
```

Tipos de tarea:

| `kind` | Forma permitida |
| --- | --- |
| `TASK` | uno o más objetivos de cualquier tipo |
| `WORKSHEET` | exactamente un objetivo `UNIT` |
| `PAGE` | exactamente un objetivo `PAGE` |
| `EXERCISE` | exactamente un objetivo `EXERCISE` |
| `REINFORCEMENT` | exactamente un objetivo `EXERCISE` |

Un objetivo `UNIT` recibe `bookId` y `unitId`; uno `PAGE`, `bookId` y `page`;
uno `EXERCISE`, `bookId` y `exerciseId`. El cliente no puede fijar checksums,
versiones, páginas de un ejercicio, títulos o revisiones: el servidor deriva
esos campos del contenido publicado.

Si todos los objetivos son ejercicios, `minimumTurnsPerItem` vale 1 por
defecto. En fichas, páginas o tareas mixtas vale 0 porque algunas páginas
pueden ser de orientación o evaluación y no admitir tutor; el docente puede
fijarlo explícitamente cuando el contenido permita acompañamiento.

La respuesta `201` entrega el registro administrativo, `publicToken` y
`shareUrl`. El token solo vuelve a salir por rutas administrativas autorizadas.

## Rutas administrativas

Todas exigen el Bearer administrativo. Las lecturas y descargas reciben
`teacherId` en query; las mutaciones que no lo llevan en query lo reciben en el
cuerpo. El servicio comprueba que la tarea pertenezca a ese docente.

| Método y ruta | Uso |
| --- | --- |
| `GET /api/assignments?teacherId=...` | listar con paginación |
| `POST /api/assignments` | crear |
| `GET /api/assignments/:id?teacherId=...` | ver detalle |
| `PATCH /api/assignments/:id?teacherId=...` | cambiar fechas, criterios o estado |
| `GET /api/assignments/:id/share?teacherId=...` | recuperar enlace |
| `GET /api/assignments/:id/qr?teacherId=...&format=svg` | descargar `svg`, `png` o `pdf` |
| `POST /api/assignments/:id/rotate-token` | invalidar el QR anterior |
| `GET /api/assignments/:id/progress?teacherId=...` | ver agregados anónimos |

El `PATCH` admite `title`, `instructions`, `groupLabel`, `availableFrom`,
`expiresAt`, `maxHintLevel`, `minimumTurnsPerItem`, `requiredItemCount` y
`status`. No modifica los objetivos ni su snapshot; para cambiar contenido se
crea otra tarea.

## Flujo público

1. `GET /a/:publicToken` muestra los objetivos sin solicitar una cuenta.
2. `POST /api/assignments/public/:publicToken/runs` crea una ejecución anónima
   y devuelve `resumeToken`.
3. El navegador guarda ese token localmente y lo usa como Bearer.
4. `POST /api/assignment-runs/current/items/:itemId/session` abre una sesión
   pedagógica vinculada al objetivo.
5. `/api/tutor` consulta por loopback la evidencia de la página o ficha; en un
   ejercicio usa su revisión publicada. Persiste únicamente las métricas
   anónimas del nuevo estado.
6. `POST /api/assignment-runs/current/items/:itemId/complete` valida el mínimo
   de turnos y completa el objetivo.
7. Al alcanzar `requiredItemCount`, la respuesta incluye un enlace
   `/completado/:receiptToken`.

Las operaciones con una ejecución usan:

```http
Authorization: Bearer <resumeToken>
```

`GET /api/assignment-runs/current` permite recuperar su estado. El comprobante
se puede validar en `GET /api/completions/:receiptToken`; solo expone el título,
fecha y conteos de finalización.

## Límites del piloto

- No existe todavía login docente ni autorización por usuario; el Bearer
  administrativo es una credencial de integración temporal.
- El progreso es anónimo por ejecución. No se puede atribuir a un estudiante
  sin introducir posteriormente un flujo institucional de identidad y
  consentimiento.
- Los rate limits y el anti-replay pedagógico viven en memoria y presuponen una
  sola instancia Next.js. PostgreSQL sí conserva tareas, ejecuciones y
  agregados después de un reinicio.
- No hay todavía exportación masiva, envío directo a WhatsApp ni PDF con
  maquetación personalizada; se entrega el enlace y el QR descargable.
- No existe un job automático de retención. Antes de un piloto real debe
  definirse y ejecutar la política de archivo/eliminación del centro educativo.
