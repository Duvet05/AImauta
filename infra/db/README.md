# Base de datos local (Postgres para Prisma)

Este directorio levanta un Postgres de **desarrollo local** para el directorio
escolar de Prisma (`Level → Grade → Course → Student/Teacher`, ver
[`prisma/schema.prisma`](../../prisma/schema.prisma)). No es la topología de
producción: sin réplicas, sin política de respaldo, sin TLS. El puerto solo se
publica en `127.0.0.1`.

## Uso

```bash
cp infra/db/db.env.example infra/db/db.env
# editar infra/db/db.env y fijar POSTGRES_PASSWORD
chmod 600 infra/db/db.env

docker compose --env-file infra/db/db.env -f infra/db/compose.yaml up -d
```

`db.env` queda ignorado por Git, debe conservar modo `0600` y no se debe
commitear. No ejecute `git clean -fdX`: ese modo también elimina archivos
ignorados que contienen secretos, incluidos `.env` e `infra/db/db.env`.

En la raíz del proyecto, `.env` debe apuntar al mismo usuario, contraseña,
base de datos y puerto que `infra/db/db.env`:

```dotenv
DATABASE_URL="postgresql://aimauta:<password>@localhost:5432/aimauta?schema=public"
```

Luego, aplicar el esquema:

```bash
npm run db:migrate
npm run db:seed
```

`db:migrate` usa el flujo interactivo de desarrollo. Para alinear una base ya
existente exclusivamente con migraciones confirmadas, use
`npx prisma migrate deploy` y después `npm run db:seed`. La migración que
introduce `Enrollment` copia primero cada relación de `_StudentCourses` y solo
entonces elimina la tabla implícita; nunca se acepta una migración que descarte
matrículas existentes.

Los datos persisten en el volumen nombrado `aimauta-db-data` entre reinicios
del contenedor. Para descartarlos por completo:

```bash
docker compose -f infra/db/compose.yaml down -v
```

## Parar sin perder datos

```bash
docker compose -f infra/db/compose.yaml down
```

## Actualizar la imagen

La referencia fijada es `postgres:16.14-alpine`, digest AMD64/ARM64
`sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`. Para
actualizar, resolver el nuevo digest y cambiar versión y digest juntos; no usar
`latest` ni una etiqueta sin digest.
