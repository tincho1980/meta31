# Setup — pasos que corre Martín

2 oct 2026 · E0. Todo lo que necesita credenciales o toca producción. Claude prepara los comandos; Martín los corre.

Los comandos son para PowerShell, desde la raíz del repo (`C:\desarrolloWeb\proyectos\meta31`), salvo que se indique otra carpeta.

## 0. Requisitos locales

- Node 22+ y pnpm 11 (ya instalados).
- `pnpm install` en la raíz.
- Cliente de PostgreSQL con `pg_dump` y `pg_restore` (para el backup, paso 8). La versión tiene que ser **igual o mayor** que la del Postgres de Supabase (Dashboard → Project Settings → Infrastructure). Para Postgres 17:
  ```powershell
  winget install PostgreSQL.PostgreSQL.17
  ```
  El instalador trae también el servidor; alcanza con instalar *Command Line Tools*. Después agregar `C:\Program Files\PostgreSQL\17\bin` al PATH (o pasarle `-PgDump` al script de backup).

## 1. Datos del proyecto Supabase

Del Dashboard de Supabase anotar (ninguno va al repo salvo lo indicado):

| Dato | Dónde | Va en |
| --- | --- | --- |
| Project ref y URL (`https://<ref>.supabase.co`) | Project Settings → General / Data API | `apps/worker/wrangler.jsonc` (`SUPABASE_URL`, no es secreto) y `apps/web/.env.*` |
| Publishable key (o anon key legada) | Project Settings → API Keys | `apps/web/.env.*` (es pública, termina en el bundle) |
| Cadena del **Session pooler** (puerto 5432) | Connect → Session pooler | `packages/db/.env`, `%USERPROFILE%\.meta31\backup.env` y Hyperdrive |
| Tipo de firma de los JWT | Project Settings → JWT Keys | Ver abajo |

**Firma de los JWT.** Si en *JWT Keys* el proyecto usa claves asimétricas (ECC P-256 / RSA), el Worker verifica contra el JWKS público y no hace falta ningún secreto. Si todavía usa el *Legacy JWT secret* (HS256), hay que cargarlo como secreto del Worker (paso 4). Recomendado: migrar a claves asimétricas desde ese mismo panel; el Worker acepta las dos.

**Auth → URL Configuration:**
- Site URL: la URL de Pages (paso 6), p. ej. `https://meta31.pages.dev`.
- Redirect URLs: agregar `http://localhost:5173` y la URL de Pages.

**Auth → Providers → Google:** habilitado con la credencial OAuth de Google. En Google Cloud, la credencial tiene que tener como *Authorized redirect URI* `https://<ref>.supabase.co/auth/v1/callback`.

## 2. Migración inicial

Crear `packages/db/.env` copiando `packages/db/.env.example` y completar `DATABASE_URL` (Session pooler) y los mails de la lista blanca.

```powershell
pnpm --filter @meta31/db migrate
```

Aplica `packages/db/migrations/*.sql` contra Supabase: crea las 21 tablas con RLS activado y sin políticas (RNF-09) y registra la migración en `drizzle.__drizzle_migrations`. Nada se toca a mano en el panel.

## 3. Seed de personas

```powershell
pnpm --filter @meta31/db seed
```

Carga Martín y Rosalía (usuarios, con los mails de `SEED_EMAIL_MARTIN` y `SEED_EMAIL_ROSALIA`), Amaia (no usuaria) y las categorías del sistema ("Tarjetas de crédito" y "Alquileres"). Es idempotente: correrlo de nuevo actualiza los mails y agrega las categorías que falten, sin duplicar. Los mails son la lista blanca del login: tienen que ser exactamente los de las cuentas de Google.

## 4. Cloudflare: login, Hyperdrive y secretos

Desde `apps/worker`:

```powershell
cd apps/worker
pnpm exec wrangler login
```

Crear la configuración de Hyperdrive con la cadena de conexión directa de Supabase (o la del Session pooler si falla, ver nota):

```powershell
pnpm exec wrangler hyperdrive create meta31-db --connection-string="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" --caching-disabled
```

- Devuelve un `id`: pegarlo en `apps/worker/wrangler.jsonc` en lugar de `REEMPLAZAR_CON_ID_DE_HYPERDRIVE` (no es secreto, se commitea).
- `--caching-disabled`: Hyperdrive cachea por defecto las lecturas 60 s. En una app que escribe un pago y vuelve a leer el mes, eso mostraría datos viejos. Se desactiva; el pooling sigue.
- **Nota IPv6:** la conexión directa de Supabase en el plan free puede ser solo IPv6. Si `hyperdrive create` falla al conectar, usar la cadena del **Session pooler** (puerto 5432). No usar el *Transaction pooler* (6543).

Completar en `wrangler.jsonc`:
- `SUPABASE_URL` = `https://<ref>.supabase.co`
- `ALLOWED_ORIGINS` = `http://localhost:5173,https://<proyecto>.pages.dev` (la URL real que devuelva el paso 6).

Solo si el proyecto firma con HS256 legado:

```powershell
pnpm exec wrangler secret put SUPABASE_JWT_SECRET
```

Pide el valor por consola; no queda en ningún archivo.

## 5. Deploy del Worker (primera vez; después lo hace el CI, ver paso 10)

```powershell
pnpm --filter @meta31/worker run deploy
```

Publica en `https://meta31-api.<subdominio>.workers.dev`. Anotar esa URL para la PWA.

Prueba rápida (sin token tiene que dar 401):

```powershell
curl.exe -i https://meta31-api.<subdominio>.workers.dev/api/me
```

## 6. Deploy de la PWA (primera vez; después lo hace el CI, ver paso 10)

Crear `apps/web/.env.production.local` (no va al repo) con:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
VITE_API_URL=https://meta31-api.<subdominio>.workers.dev
```

Primera vez, crear el proyecto de Pages:

```powershell
cd apps/worker
pnpm exec wrangler pages project create meta31 --production-branch main
```

Build y deploy (cada vez):

```powershell
pnpm --filter @meta31/web build
cd apps/worker
pnpm exec wrangler pages deploy ../web/dist --project-name meta31 --branch main
```

Si `meta31` ya está tomado, Cloudflare asigna otro subdominio: actualizar `ALLOWED_ORIGINS` (paso 4), la Site URL y las Redirect URLs de Supabase (paso 1) y volver a desplegar el Worker.

## 7. Desarrollo local

```powershell
# Worker (puerto 8787): Hyperdrive local apunta directo a Supabase
$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
pnpm dev:worker
```

Si el proyecto usa HS256 legado, copiar `apps/worker/.dev.vars.example` a `apps/worker/.dev.vars` y completar el secreto.

```powershell
# PWA (puerto 5173), en otra terminal. Antes: copiar apps/web/.env.example a apps/web/.env.local y completar.
pnpm dev:web
```

**Modo local, sin Supabase ni login de Google** (recomendado para probar pantallas sin tocar datos reales): dos terminales desde la raíz.

```powershell
pnpm dev:local
```

```powershell
pnpm dev:local:web
```

El primero levanta la API real (Hono) sobre un Postgres en memoria persistido en `.local-db/` (PGlite, mismas migraciones), con Martín y Rosalía de prueba, las categorías del sistema y dos cotizaciones. El segundo levanta la PWA en `http://localhost:5173` sin pedir login. Para empezar de cero, borrar la carpeta `.local-db/`. Nada de esto llega a producción: el servidor local no lo importa el Worker y el salteo del login solo existe en `vite dev`.

Tests (no necesitan credenciales, usan PGlite en memoria): `pnpm test`. Tipos: `pnpm typecheck`.

## 8. Backup semanal (RNF-12)

Crear `%USERPROFILE%\.meta31\backup.env` con una sola línea:

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Probarlo a mano:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup.ps1
```

Deja `meta31-AAAA-MM-DD_HHMM.dump` en `%OneDrive%\Backups\meta31` (conserva los últimos 12) y un `backup.log`. Vuelca los esquemas `public` (datos) y `drizzle` (migraciones), no los que administra Supabase.

Programarlo:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\desarrolloWeb\proyectos\meta31\scripts\backup.ps1" -PgDump "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Thursday -At 21:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
Register-ScheduledTask -TaskName 'meta31 backup' -Action $action -Trigger $trigger -Settings $settings -Description 'pg_dump de meta31 a OneDrive'
```

Corre lunes y jueves: el plan free pausa el proyecto a los 7 días sin actividad y una corrida por semana queda justo en el límite. `-StartWhenAvailable` lo ejecuta al prender la compu si se perdió el horario.

Restaurar (sobre una base vacía o para pisar la actual):

```powershell
pg_restore --clean --if-exists --no-owner --no-privileges -d "<DATABASE_URL>" "<archivo>.dump"
```

## 9. Cierre de E0

1. Desde el celular, abrir la URL de Pages, *Ingresar con Google* con la cuenta de Martín → "Hola, Martín".
2. Instalar la PWA (menú del navegador → Instalar app / Agregar a pantalla de inicio).
3. Con una cuenta de Google que no esté en la lista → "La cuenta … no está habilitada." (el Worker responde 403).

## 10. Deploy automático desde `main`

Desde el 3/10 no se publica a mano. Al mergear un PR a `main`, el workflow `.github/workflows/ci.yml` corre `verify` y, si pasa, el job `deploy` publica el Worker y después la PWA.

Pages no se conectó a GitHub desde el panel: un proyecto creado con *Direct Upload* no se puede pasar a la integración con Git. Por eso el deploy lo hace GitHub Actions con `wrangler`, y así queda atado a que pasen los tests.

**Configuración en GitHub** (ya hecha, salvo el token): environment `production`, que solo pueden usar jobs sobre `main`.

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secreto | token de API de Cloudflare (ver abajo) |
| `CLOUDFLARE_ACCOUNT_ID` | variable | ID de la cuenta de Cloudflare |
| `VITE_SUPABASE_URL` | variable | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | variable | publishable key (es pública) |
| `VITE_API_URL` | variable | URL del Worker |

**Token de API de Cloudflare.** En el panel: My Profile → API Tokens → Create Token → plantilla *Edit Cloudflare Workers*. Agregar el permiso **Account · Cloudflare Pages · Edit**. En *Account Resources*, solo tu cuenta; en *Zone Resources*, *All zones* (no hay zonas propias). Crear y copiar el token (se muestra una sola vez). Cargarlo sin que quede en ningún archivo:

```powershell
gh secret set CLOUDFLARE_API_TOKEN --repo tincho1980/meta31 --env production
```

Pide el valor por consola.

**Migraciones.** El CI no migra la base de Supabase (no tiene la cadena de conexión). Si un PR trae una migración nueva, correr `pnpm --filter @meta31/db migrate` **antes** de mergear a `main`, para que el Worker nuevo no arranque contra un schema viejo. Las migraciones tienen que ser compatibles con el Worker anterior (agregar columnas o tablas, no renombrar ni borrar en el mismo paso).

**Deploy manual de emergencia** (solo si GitHub Actions no anda): pasos 5 y 6, desde `main` actualizado.
