# AImauta

AImauta es un espacio de aprendizaje guiado para estudiantes escolares del
Perú. Mantiene el material visible, pide al estudiante que escriba su intento y
usa un tutor socrático para ofrecer una pregunta o una pista breve, sin resolver
el ejercicio por él.

## Estado del MVP

El primer recorrido vertical ya está definido:

1. El estudiante elige un material del catálogo.
2. Un visor PDF lo muestra desde una ruta **same-origin** de Next.js.
3. El estudiante indica la página y escribe su intento.
4. El servidor recupera fragmentos de esa página y páginas cercanas mediante un
   índice léxico.
5. Gemma, servido por Ollama, genera una orientación breve basada en esa
   evidencia. Si Ollama no está disponible, el servidor responde con una guía
   segura predefinida.

El tutor valida el libro y la página en el servidor, no confía en texto enviado
por el navegador, limita la historia conversacional y mantiene
`canRevealSolution: false`.

## Primer material autorizado

El catálogo inicial contiene **Fichas de Matemática 1**, del Ministerio de
Educación del Perú:

- ficha oficial:
  [Repositorio Institucional del MINEDU, handle 10834](https://repositorio.minedu.gob.pe/handle/20.500.12799/10834);
- licencia verificada:
  [Creative Commons Atribución 4.0](https://creativecommons.org/licenses/by/4.0/);
- procedencia de descubrimiento:
  `librosescolaresperu.com`;
- procedencia de importación: exclusivamente la descarga oficial del MINEDU.

El sitio de terceros se usa para descubrir materiales, no como fuente de
descarga ni como evidencia de licencia.

## Ejecución y compilación

Las instalaciones, la sincronización de contenido, la indexación, las pruebas y
la compilación de este proyecto se ejecutan **exclusivamente en PowerEdge**. No
se ejecutan builds ni instalaciones en la Mac de desarrollo.

Rutas operativas:

```text
/home/hii1sc/aimauta-build
/home/hii1sc/aimauta-runtime/content
/home/hii1sc/aimauta-runtime/indexes
```

Secuencia principal en PowerEdge:

```bash
cd /home/hii1sc/aimauta-build
npm ci
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content npm run content:sync
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run content:index
AIMAUTA_CONTENT_DIR=/home/hii1sc/aimauta-runtime/content \
  AIMAUTA_INDEX_DIR=/home/hii1sc/aimauta-runtime/indexes \
  npm run build
```

La configuración de producción se crea a partir de `.env.example`. Ollama debe
permanecer privado y ser accesible desde PowerEdge únicamente por Tailscale o
por un túnel privado equivalente.

## Límites de contenido y datos

- No se versionan PDFs, índices extraídos ni manifiestos generados.
- No se importa un material sin una ficha oficial del MINEDU y una licencia
  verificada que permita el uso previsto.
- No se guardan en Git conversaciones, intentos, nombres ni otros datos de
  menores de edad.
- Una autorización de rastreo o un enlace público no equivale a una licencia de
  redistribución.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Política de contenidos](docs/CONTENT_POLICY.md)
- [Despliegue en PowerEdge](docs/DEPLOYMENT.md)
