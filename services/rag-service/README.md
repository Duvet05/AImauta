# Servicio RAG interno

Evolución endurecida del prototipo de Marcelo. Conserva el límite de servicio
HTTP separado, pero en producción:

- es opcional y no participa del arranque de la web;
- escucha únicamente en `127.0.0.1:3311` (el `3310` queda reservado para la
  UI privada de revisión);
- exige un secreto dedicado antes de leer una solicitud;
- no recibe claves de Google, OpenAI ni xAI;
- no genera respuestas y no persiste preguntas ni intentos;
- consume exclusivamente los índices v2 generados y revisados por AImauta;
- exige que checksum, versión curricular, ejercicio, revisión, digest del
  ancla humana, regiones, unidad, etapa y páginas coincidan;
- excluye contenido `teacherOnly` y toda etapa `assessment`;
- limita la respuesta a cinco fragmentos y 1 200 caracteres por fragmento.

El router cloud configurado continúa eligiendo el movimiento pedagógico; admite
OpenAI, xAI y Gemini en una cadena explícita.
La evidencia humana del release atómico sigue siendo obligatoria y primaria.
Si este servicio no responde, no tiene índice o rechaza el linaje, el tutor
continúa con esa evidencia local exacta.
