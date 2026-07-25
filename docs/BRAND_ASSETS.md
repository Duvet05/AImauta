# Sistema visual de AImauta

Los assets de `public/brand` derivan de la ilustración editorial `amauta.jpg`
entregada para este proyecto. La interfaz combina dos lenguajes:

- **Vector funcional:** marcas e iconos SVG con pocos trazos y sin raster
  embebido.
- **Grabado editorial:** WebP con textura para el hero y estados expresivos del
  personaje.

## Paleta

| Token | Valor | Uso |
| --- | --- | --- |
| Ink | `#172d2a` | contornos, texto y estructura |
| Coral | `#ee8068` | identidad del personaje |
| Paper | `#fffdf7` | fondos y detalles |
| Lime | `#d9ed8d` | acciones y estados seguros de aprendizaje |

El coral de marca no reemplaza el rojo semántico usado para delimitar
ejercicios detectados.

## Inventario

| Asset | Uso recomendado |
| --- | --- |
| `amauta-icon.svg` | favicon y marca menor de 64 px |
| `amauta-apple-touch.png` | icono de instalación en iOS y accesos directos |
| `amauta-mark-duotone.svg` | marca principal desde 96 px |
| `amauta-mark-mono.svg` | impresión o contextos de una tinta |
| `amauta-pattern.svg` | textura geométrica sutil |
| `amauta-divider.svg` | separadores editoriales |
| `amauta-editorial.webp` | hero y piezas de archivo |
| `paper-texture.webp` | textura de fondo con opacidad baja |
| `characters/amauta-points.webp` | señalar una pista o ejercicio |
| `characters/amauta-thinks.webp` | espera o razonamiento del estudiante |
| `characters/amauta-hint.webp` | entrega de una pista |
| `characters/amauta-celebrates.webp` | confirmación positiva |

## Reglas de uso

- No usar el SVG detallado por debajo de 64 px; usar `amauta-icon.svg`.
- Mantener margen libre equivalente al ancho de un ojo alrededor de la marca.
- Las poses WebP son decorativas salvo que comuniquen un estado no expresado
  por texto. En ese caso deben recibir una descripción accesible.
- No animar continuamente el personaje. Respetar
  `prefers-reduced-motion`.
- No recolorear el rostro con colores de error, evaluación o advertencia.

## Procedencia

Antes de un despliegue público definitivo debe documentarse la procedencia y
licencia de la ilustración fuente. Esta revisión no debe inferirse únicamente
por la antigüedad aparente del material.
