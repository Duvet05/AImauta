# Servicio RAG interno

Evolución endurecida del prototipo de Marcelo. Conserva el límite de servicio
HTTP separado, pero en producción:

- escucha únicamente en `127.0.0.1:3310`;
- no recibe claves de Google, OpenAI ni xAI;
- no genera respuestas y no persiste preguntas ni intentos;
- consume exclusivamente los índices v2 generados y revisados por AImauta;
- exige que checksum, versión curricular, unidad, etapa y páginas coincidan;
- excluye contenido `teacherOnly` y toda etapa `assessment`;
- limita la respuesta a cinco fragmentos y 1 200 caracteres por fragmento.

OpenAI continúa eligiendo el movimiento pedagógico y xAI es su único fallback.
Si este servicio no responde o rechaza el linaje, Next.js usa el recuperador
local validado.
