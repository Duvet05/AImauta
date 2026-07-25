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

## Puerta de publicación para cada material

Un candidato puede registrarse administrativamente como `draft` o `review`
después de fijar su identidad, procedencia y checksum. Antes de promoverlo a
`published`, copiarlo al runtime público o indexarlo deben cumplirse todos estos
pasos:

1. Registrar la URL donde fue descubierto.
2. Encontrar el **handle oficial** del Repositorio Institucional del MINEDU.
3. Confirmar título, edición, autores o entidad responsable y número de páginas.
4. Verificar en la ficha o en el propio documento una licencia compatible con
   el uso y la atribución previstos.
5. Registrar la URL oficial de descarga; nunca una copia de terceros.
6. Revisar manualmente que el archivo corresponda a la ficha.
7. Fijar tamaño y SHA-256 en el catálogo.
8. Añadir una taxonomía normalizada y un currículo versionado que cubra todas
   las páginas una sola vez, incluya al menos una unidad y modele en cada
   unidad `learn → practice → assessment` en ese orden.
9. Ejecutar `npm run catalog:validate`, la sincronización y la indexación en
   PowerEdge.
10. Revisar el reporte de calidad de extracción antes del despliegue.

Si falta la ficha oficial, la licencia es ambigua o la edición descargada no
coincide, el material puede conservarse únicamente en el registro
administrativo y el inbox privado: no se promueve, no se muestra y no se
indexa.

La ruta local vuelve a verificar tamaño y SHA-256 antes de servir. Solo
reutiliza ese resultado mientras dispositivo, inodo, tamaño, `mtime` y `ctime`
permanezcan idénticos.

## Estados y publicación cerrada

Cada entrada del catálogo tiene uno de estos estados:

- `draft`: registro incompleto, solo administrativo;
- `review`: fuente, licencia, identidad y currículo bajo revisión;
- `published`: superó las puertas de publicación y puede llegar al estudiante;
- `disabled`: retirado de la vista pública.

Las funciones públicas solo devuelven `published`. Los demás estados, un
currículo ausente o ambiguo y cualquier fallo de validación se tratan como
material no disponible. Tamaño y SHA-256 son obligatorios en todos los estados:
un borrador no puede representar un archivo de identidad desconocida. Cambiar
el estado no sustituye la revisión: `published` exige fuente oficial permitida,
metadatos de licencia y atribución, y exactamente un currículo versionado con
unidades semánticamente completas, sin huecos ni solapamientos. La orientación
por sí sola nunca constituye un currículo publicable y sus páginas nunca
habilitan tutor ni consultas RAG; la ayuda requiere una sección explícita
`learn` o `practice`.

`licenseReviewedAt` registra cuándo se examinó la evidencia de licencia; no
significa que la publicación haya sido aprobada.

Cada entrada declara además `publicationBlockers`. Una entrada `published`
debe tener la lista vacía; cualquier bloqueo pendiente invalida la promoción
aunque alguien cambie únicamente el estado.

## Materiales aprobados

### Fichas de Matemática 1

- **Entidad:** Ministerio de Educación del Perú.
- **Ficha oficial:**
  [handle 20.500.12799/10834](https://repositorio.minedu.gob.pe/handle/20.500.12799/10834).
- **Edición:** cuarta edición, octubre de 2023; primera reimpresión, setiembre
  de 2024.
- **Tamaño fijado:** 32 895 443 bytes.
- **SHA-256:** `c220ec82ed676a813977d61afea236e761c5253ef0beb0b0de9afccaf2eeaac0`.
- **Licencia registrada:**
  [Creative Commons Atribución 4.0 Internacional](https://creativecommons.org/licenses/by/4.0/).
- **Atribución:** Ministerio de Educación del Perú; Larisa Mansilla Fernández;
  Olber Muñoz Solís; Juan Carlos Chávez Espino; Hugo Luis Támara Salazar;
  Hubner Luque Cristóbal Jave; Enrique García Manyari; Emilia Gabriela Del
  Busto Sipán.

### Fichas de Matemática 2

- **Entidad:** Ministerio de Educación del Perú.
- **Ficha oficial:**
  [handle 20.500.12799/10835](https://repositorio.minedu.gob.pe/handle/20.500.12799/10835).
- **Edición:** cuarta edición, octubre de 2023; primera reimpresión, setiembre
  de 2024.
- **Tamaño fijado:** 31 997 485 bytes.
- **SHA-256:** `c5c116ed7c6f091630e39d1cbeb0aa6fa2095157734daa33c5eb58ae470089a0`.
- **Licencia registrada:**
  [Creative Commons Atribución 4.0 Internacional](https://creativecommons.org/licenses/by/4.0/).
- **Atribución:** Ministerio de Educación del Perú; Larisa Mansilla Fernández;
  Olber Muñoz Solís; Juan Carlos Chávez Espino; Hugo Luis Támara Salazar;
  Hubner Luque Cristóbal Jave; Enrique García Manyari; Marilú Yésica Quispe
  Amar.

Ambos materiales fueron descubiertos mediante páginas de referencia de
`librosescolaresperu.com`, pero se descargan exclusivamente desde el
Repositorio Institucional del MINEDU. Los metadatos canónicos y la evidencia
de licencia también proceden de la ficha oficial. La licencia y la identidad
se revisan por edición: aprobar un PDF no aprueba automáticamente otros
materiales del mismo sitio, colección o entidad.

## Materiales en revisión

Las fichas de Matemática de 3.º, 4.º y 5.º de secundaria registradas durante
la revisión de 2026 están en estado `review`. Los archivos oficiales son la
cuarta edición de octubre de 2023, primera reimpresión de setiembre de 2024;
la fecha de una página de descubrimiento no reemplaza la edición impresa.

El Repositorio Institucional del MINEDU declara CC BY 4.0 en sus metadatos,
pero el aviso interior de los cinco PDF de la serie conserva una reserva
general de derechos. El catálogo identifica expresamente que la licencia
procede del metadato oficial; la diferencia requiere una revisión editorial
separada. Esta incorporación no cambia el estado público preexistente de 1.º y
2.º.

Aunque la clasificación curricular de 3.º, 4.º y 5.º ya está completa, sus
entradas conservan `publication-review-pending` y sus PDF permanecen en el
inbox privado: no aparecen en el catálogo del estudiante y no pueden activar
PDF público, ejercicios, tutor ni RAG.

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
/home/hii1sc/aimauta-ingest/inbox
/home/hii1sc/aimauta-runtime/content
/home/hii1sc/aimauta-runtime/indexes
/home/hii1sc/aimauta-runtime/manifests
```

El inbox contiene únicamente candidatos privados con permisos restringidos.
Solo un material que supera la revisión se promueve al runtime público.

Git contiene solamente el catálogo de metadatos revisados, el código y la
documentación. Los artefactos derivados deben poder reproducirse desde la fuente
oficial y el checksum registrado.

## Atribución y trazabilidad

La interfaz debe mostrar, como mínimo:

- entidad y autores atribuidos por la ficha;
- edición;
- nombre y enlace de la licencia;
- enlace a la ficha oficial.

El manifiesto runtime v2 conserva por libro la fuente oficial, el archivo,
tamaño, SHA-256 y fecha de sincronización, y se actualiza de forma acumulativa
y atómica. Cada índice v2 conserva el `bookId`, la página, SHA-256 del PDF,
taxonomía, versión curricular, versión del extractor, licencia y atribución.
También registra un reporte de páginas sin texto, conteos atípicos y posibles
fragmentos reservados para docentes. Así, una cita del tutor puede rastrearse
hasta una página de una edición concreta y una extracción inesperada puede
detenerse para revisión.

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

Estas medidas no eliminan el tratamiento necesario para la voz: LiveKit Cloud
procesa el transporte y LiveKit Inference usa Deepgram para STT e Inworld para
TTS. La
inferencia aplica retención cero por defecto, pero antes de habilitar el canal
para menores se deben documentar consentimiento aplicable, acuerdos de
tratamiento, ubicación y subencargados, retención, eliminación y mecanismo para
atender derechos. No habilitar grabaciones ni observabilidad evita copias
adicionales; el flujo de voz no debe considerarse exclusivamente local.

Las credenciales de Ollama, LiveKit u otros servicios tampoco se versionan.

## Corrección o retiro

Si cambia la licencia, falla el checksum o un titular solicita revisión:

1. se cambia el material a `disabled` en el catálogo;
2. se detienen nuevas sincronizaciones;
3. se retira el PDF y su índice del almacenamiento operativo;
4. se conserva únicamente el registro administrativo mínimo necesario para
   documentar la decisión;
5. se publica la corrección de atribución cuando corresponda.

Ningún resultado pedagógico depende de mantener un material cuya autorización
sea dudosa.
