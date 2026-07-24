# Política de contenidos y datos

## Principio general

Que un material sea accesible en Internet no significa que pueda copiarse,
redistribuirse o procesarse sin condiciones. AImauta solo importa un PDF después
de verificar su procedencia oficial y la licencia aplicable a esa edición.

## Descubrimiento no es importación

`librosescolaresperu.com` puede utilizarse para descubrir que un material existe
y localizar su posible ficha de origen. No se usa como:

- repositorio de descarga;
- prueba de autoría;
- prueba de licencia;
- autorización para descargar en masa;
- fuente canónica de metadatos.

Un permiso de rastreo en `robots.txt` regula el rastreo técnico, no concede
derechos de uso. AImauta no debe replicar automáticamente el catálogo completo
ni descargar de forma masiva desde ese sitio.

## Puerta de entrada para cada material

Antes de añadir un libro al catálogo deben cumplirse todos estos pasos:

1. Registrar la URL donde fue descubierto.
2. Encontrar el **handle oficial** del Repositorio Institucional del MINEDU.
3. Confirmar título, edición, autores o entidad responsable y número de páginas.
4. Verificar en la ficha o en el propio documento una licencia compatible con
   el uso y la atribución previstos.
5. Registrar la URL oficial de descarga; nunca una copia de terceros.
6. Revisar manualmente que el archivo corresponda a la ficha.
7. Fijar tamaño y SHA-256 en el catálogo.
8. Ejecutar la sincronización y la indexación en PowerEdge.

Si falta la ficha oficial, la licencia es ambigua o la edición descargada no
coincide, el material no se importa, no se muestra y no se indexa.

## Primer material aprobado

El material inicial es:

- **Título:** Fichas de Matemática 1.
- **Entidad:** Ministerio de Educación del Perú.
- **Ficha oficial:**
  [handle 20.500.12799/10834](https://repositorio.minedu.gob.pe/handle/20.500.12799/10834).
- **Licencia registrada:**
  [Creative Commons Atribución 4.0 Internacional](https://creativecommons.org/licenses/by/4.0/).
- **Atribución:** Ministerio de Educación del Perú y autores consignados en la
  ficha oficial.
- **Descubrimiento:** página de referencia en
  `librosescolaresperu.com`.

La licencia y la identidad del archivo se revisan por edición. La aprobación de
este PDF no aprueba automáticamente otros materiales del mismo sitio, colección
o entidad.

## Almacenamiento

Los siguientes artefactos son operativos y no se incorporan a Git:

- PDFs descargados;
- texto extraído;
- índices léxicos o vectoriales;
- manifiestos generados;
- archivos temporales de sincronización;
- registros de conversación o intentos de estudiantes.

En PowerEdge se almacenan en:

```text
/home/hii1sc/aimauta-runtime/content
/home/hii1sc/aimauta-runtime/indexes
```

Git contiene solamente el catálogo de metadatos revisados, el código y la
documentación. Los artefactos derivados deben poder reproducirse desde la fuente
oficial y el checksum registrado.

## Atribución y trazabilidad

La interfaz debe mostrar, como mínimo:

- entidad y autores atribuidos por la ficha;
- edición;
- nombre y enlace de la licencia;
- enlace a la ficha oficial.

Cada índice conserva el `bookId`, la página y el SHA-256 del PDF de origen. Así,
una cita del tutor puede rastrearse hasta una página de una edición concreta.

## Privacidad de estudiantes

AImauta está dirigido a menores de edad y aplica minimización de datos:

- no se almacenan nombres, correos, códigos de alumno ni conversaciones en Git;
- el MVP no requiere identificar al estudiante;
- el registro anti-replay conserva únicamente identificador, revisión y
  expiración de sesión en memoria; se pierde al reiniciar, funciona en una sola
  instancia y no equivale a progreso durable;
- no se incorporan analíticas individuales hasta definir finalidad, retención,
  acceso, consentimiento y proceso de eliminación;
- los logs técnicos no deben incluir el texto completo del intento o la
  conversación;
- el worker usa `record=False` para desactivar la grabación de Agent Insights y
  logs `WARN` redactados;
- el avatar usa un personaje sintético CC0, se renderiza en el navegador y no
  solicita cámara ni publica video;
- cualquier conjunto de evaluación debe ser sintético o estar anonimizado y
  autorizado.

Estas medidas no eliminan el tratamiento necesario para la voz: la instancia
LiveKit self-hosted procesa el transporte de audio y paquetes de datos, y
Deepgram procesa audio y transcripciones para STT/TTS. Antes de habilitar el
canal para menores se deben documentar consentimiento aplicable, DPA con
Deepgram, ubicación y subencargados, retención, eliminación y mecanismo para
atender derechos. No habilitar grabaciones ni telemetría evita copias
adicionales, pero Deepgram impide considerar el flujo exclusivamente local.

Las credenciales de Ollama, LiveKit u otros servicios tampoco se versionan.

## Corrección o retiro

Si cambia la licencia, falla el checksum o un titular solicita revisión:

1. se deshabilita el material en el catálogo;
2. se detienen nuevas sincronizaciones;
3. se retira el PDF y su índice del almacenamiento operativo;
4. se conserva únicamente el registro administrativo mínimo necesario para
   documentar la decisión;
5. se publica la corrección de atribución cuando corresponda.

Ningún resultado pedagógico depende de mantener un material cuya autorización
sea dudosa.
