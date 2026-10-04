# CLAUDE.md — meta31

Sistema de planificación económica familiar de Martín y Rosalía. Muestra cuánto entra y cuánto hay que pagar cada mes, hoy y a 12 meses vista, para decidir si entra una compra en cuotas o un crédito nuevo. **No es contabilidad ni flujo de caja**: no hay cuentas, saldos ni transferencias.

Proyecto personal. Lo programa Claude con supervisión de Martín. Hablale a Martín en castellano rioplatense, de vos, directo y sin vueltas. Si una decisión suya tiene un problema, decilo con fundamento; no lo valides por defecto.

## Documentos (fuente de verdad)

| Documento | Qué tiene |
| --- | --- |
| `docs/requisitos-funcionales.md` | Alcance, conceptos, RF-01…RF-36, reglas de negocio 1–12, RNF-01…RNF-17, reportes |
| `docs/modelo-de-datos.md` | 21 tablas, columnas, enums, decisiones D1–D8, cómo se calcula un mes |
| `docs/plan-de-entregas.md` | Entregas E0–E4: alcance, tests y criterio de cierre de cada una |
| `docs/glosario-es.yml` | Traducción al castellano de cada tabla, columna y valor de enum; fuente de etiquetas de la PWA |

Reglas sobre los documentos:
- Antes de implementar algo, leé la sección que corresponde. Si el código y el documento no coinciden, **el documento manda** salvo que Martín decida otra cosa.
- Si una decisión cambia (algo nuevo, algo que se descarta, un campo que se agrega), actualizá el documento en el mismo commit que el código. Un cambio de schema sin cambio en `modelo-de-datos.md` y `glosario-es.yml` está incompleto.
- No inventes requisitos. Si falta información, preguntá.
- Estas copias se originaron en el proyecto de claude.ai "sistema de gestión económico-financiero para el hogar". Si cambian acá, avisale a Martín para que actualice allá.

## Estado actual

- Requisitos, modelo y plan: **validados** (2/10/2026).
- Repo: remoto `github.com/tincho1980/meta31`. E0 en la rama `feat/e0-esqueleto`.
- Infra creada por Martín: proyecto Supabase con login de Google configurado, credencial OAuth de Google, cuenta de Cloudflare.
- **E0: cerrado el 3/10/2026.** Login con Google desde el celular → "Hola, Martín"; una cuenta no habilitada recibe 403. Producción: PWA en `https://meta31.pages.dev`, Worker en `https://meta31-api.miramallo.workers.dev`. Se publicaron a mano desde `feat/e0-esqueleto`, así que `main` todavía no refleja producción.
- **Deploy automático:** cada merge a `main` corre `verify` y, si pasa, el job `deploy` del CI publica el Worker y la PWA (credenciales en el environment `production` de GitHub, solo para `main`). Nada de deploys a mano; detalle en `docs/setup.md` paso 10. Las migraciones contra Supabase las corre Martín antes de mergear a `main`.
- **E1 en curso:** dominio completo (períodos, montos y cotizaciones, amortización, generadores, apertura de mes, proyección y carga de cuotas). Falta la capa visible: rutas de la API, pantallas de alta (RF-34), vista del mes, proyección a 12 meses con el indicador de cuotas, y la carga inicial por script (plan, decisión 3). Meta inmediata: cerrar E1 y E2; después E3 (MCP); E4 (simulador, IPC, rentabilidad) al final.

## Stack (cerrado, no cambiar sin hablarlo)

| Capa | Elección |
| --- | --- |
| Front | React + Vite, PWA instalable, en Cloudflare Pages (subdominio `pages.dev`) |
| Back | Un único Cloudflare Worker (`workers.dev`), TypeScript, Hono, flag `nodejs_compat`. Expone la API REST de la PWA **y** el servidor MCP remoto (E3) |
| Base | Supabase Postgres (plan free). El Worker se conecta **directo** vía Hyperdrive + `pg` (node-postgres). Nunca la API REST de Supabase |
| ORM | Drizzle; schema en TS; migraciones con drizzle-kit versionadas en el repo |
| Auth | Supabase Auth con Google. La PWA manda `Authorization: Bearer <jwt>`; un middleware único del Worker lo verifica |
| Dinero | `decimal.js`. Prohibido `number` para importes |
| Tests | Vitest |
| Gestor de paquetes | pnpm (workspaces) |

Todo en planes gratuitos. Límites a vigilar (RNF-13): Worker 3 MB comprimido, 10 ms de CPU por request, 100.000 requests/día; Supabase 500 MB y pausa a los 7 días sin uso. Descartados y por qué: Prisma (peso y límites del plan free), Render (demora al despertar).

## Estructura del repo

```
apps/
  web/        React + Vite (PWA). Habla solo con el Worker, nunca con Supabase salvo para el login
  worker/     Hono: rutas REST (/api/*), MCP (/mcp, E3), middleware de auth, casos de uso
packages/
  domain/     Lógica pura: períodos, periodicidad, montos vigentes, cotizaciones, amortización,
              generadores de compromisos, proyección. Sin I/O, sin Drizzle, sin Hono
  db/         Schema Drizzle, migraciones, fábrica de cliente
docs/         Documentos del proyecto
```

Dependencias permitidas: `worker → domain, db` · `web → (tipos compartidos)` · `domain → nada` (solo `decimal.js`). Si `domain` necesita un dato, se lo pasan como argumento.

Capas dentro del Worker:
1. **Rutas** (REST y MCP): validan la entrada (zod) y llaman a un caso de uso. No tienen lógica.
2. **Casos de uso** (`services/`): abren la transacción, leen con Drizzle, llaman a `domain`, escriben. REST y MCP usan **los mismos** casos de uso: las reglas valen igual sin importar quién carga.
3. **Dominio** (`packages/domain`): funciones puras y testeables.

## Reglas de código

**Dinero y números**
- Importes `numeric(14,2)`; cotizaciones e índices `numeric(14,6)`; tasas en % `numeric(9,6)`.
- Drizzle devuelve `numeric` como string: convertilo a `Decimal` en el borde (al leer) y de vuelta a string al escribir. Nunca `parseFloat`, `Number()` ni aritmética con `number` sobre dinero.
- Cálculos intermedios con precisión completa; se redondea solo al persistir o mostrar, a 2 decimales, `ROUND_HALF_UP`.
- Cuotas que no dividen exacto: la última absorbe la diferencia.

**Fechas y períodos**
- Un período (mes) es una fecha con día 1. En el dominio se maneja como string `'YYYY-MM-01'`, no como `Date`, para evitar corrimientos de zona horaria.
- "Hoy" y "mes en curso" se calculan en `America/Argentina/Buenos_Aires`.
- Fechas sin hora: `date` en la base, `'YYYY-MM-DD'` en TS.

**Monedas**
- Todo importe se guarda con su `currency` (`ARS`, `USD`, `UYU`). **Nunca se convierte al guardar** (regla 5).
- Conversión solo al mostrar, con la cotización vigente a la fecha del importe: la fila de `exchange_rate` con mayor `valid_from ≤ fecha`. UYU → ARS pasa por USD.
- Los pagos guardan `applied_rate` y no se recalculan nunca, aunque se cargue una cotización retroactiva (regla 6).
- Totales siempre en ARS y en USD.

**Nombres**
- Base, código y herramientas MCP **en inglés**. Base en `snake_case`; TS en `camelCase` (Drizzle con `casing: 'snake_case'`). Tablas en singular.
- Textos de la interfaz **en castellano**, tomados de `docs/glosario-es.yml` (se importa en el build de la PWA). No hardcodear etiquetas en los componentes.
- Valores de enum en minúscula, salvo códigos ISO (`ARS`, `AR`…).
- **Idioma (decisión del 3/10):** en castellano solo lo que ve el usuario de la app (textos de la PWA, vía el glosario) y los documentos (`docs/` y este `CLAUDE.md`). Todo lo demás **en inglés**: comentarios, nombres de tests, mensajes de error y de log, scripts, archivos de configuración, mensajes de commit y descripciones de PR.

**Base de datos**
- PK `id uuid default gen_random_uuid()` (salvo `month`, con PK `period`).
- Columnas de auditoría en todas las tablas de dominio: `created_at`, `updated_at`, `created_by`, `updated_by`, `entry_mode` (`manual` · `claude`), `source_document_id`.
- Nada se cambia a mano en el panel de Supabase: todo por migración de drizzle-kit.
- RLS activado y **sin políticas** en todas las tablas (RNF-09). El Worker se conecta con un rol que lo saltea; la API pública de Supabase no ve nada.
- Las entidades maestras no se borran: `active` o fecha de fin. Los compromisos se anulan (`cancelled`), no se borran.
- Las escrituras que tocan varias tablas (cargar resumen, pagar, postergar, confirmar un comprobante) van en **una transacción**.
- En el Worker se crea un cliente `pg` por request contra Hyperdrive (Hyperdrive hace el pooling). No guardar conexiones en variables globales.

**Seguridad**
- Secretos solo en `.dev.vars` (local, en `.gitignore`) y en `wrangler secret`. Nunca en el repo, nunca en el chat.
- Middleware único de auth en el Worker: verifica la firma del JWT de Supabase (con `jose` contra el JWKS del proyecto; si el proyecto usa el secreto HS256 legado, con ese) y que el mail esté en la lista blanca (`person.email` con `is_user = true`). Fuera de la lista: 403.
- El MCP no expone SQL libre: solo operaciones del dominio.

## Conceptos y reglas de negocio (resumen; detalle en los docs)

**Compromiso (`commitment`)**: algo que hay que pagar en un mes. Lo generan tarjetas, gastos recurrentes, gastos puntuales y préstamos. Tiene `estimated_amount` y, cuando se conoce, `actual_amount`. Estados guardados: `pending`, `partially_paid`, `paid`, `cancelled`. "Postergado" no es un estado: se deriva de `origin_period ≠ period`.

**Ingreso (`income`)**: lo mismo del lado de los ingresos. `expected` → `received`.

**Resultado del mes** = ingresos − compromisos. **No se arrastra** al mes siguiente; solo pasan los compromisos postergados.

Las 12 reglas de negocio (`docs/requisitos-funcionales.md`) son invariantes. Las más fáciles de romper:
1. **Sin doble conteo.** Lo que se paga con tarjeta vive solo dentro del resumen (`card_transaction`); el compromiso es el pago del resumen. `recurring_expense` es solo lo que se paga fuera de tarjeta.
2. Un recurrente pagado alguna vez con tarjeta: ese mes su compromiso se anula con motivo y queda como movimiento del resumen.
3. Las tarjetas argentinas se pagan en ARS y la uruguaya en UYU, incluida la parte en USD, con la cotización aplicada.
4. Pago parcial de tarjeta: lo no pagado pasa como saldo anterior del resumen siguiente; los intereses, como costo financiero.
8. Un impuesto anual genera un solo compromiso en su mes de pago.
11. Cuotas, préstamos e ingresos con fin dejan de proyectarse solos.
12. **Lo que carga Claude no toca ningún dato hasta que un usuario lo confirma.**

## Decisiones de diseño (D1–D8)

- **D1 · Lo futuro se calcula, no se guarda.** Los compromisos e ingresos futuros son virtuales: los genera `domain` desde las reglas. Se graban (materializan) solo al abrir el mes en curso o cuando algo los toca (pago, postergación, monto real). Lo grabado y lo virtual se unen por `source_key` única: un candidato virtual cuya `source_key` ya existe se descarta. Abrir un mes es idempotente.
- **D2 · Una sola tabla para servicios, impuestos, expensas, recurrentes y rubros estimados**: `recurring_expense` con `class` (`utility`, `tax`, `condo_fee`, `recurring`, `budget`).
- **D3 · Claude propone, el usuario confirma.** Claude graba en `source_document` la operación propuesta (`operation` + `payload`). Confirmar ejecuta esa operación en una transacción, por el mismo caso de uso que usa la PWA. Duplicados: `file_hash` único + claves naturales (p. ej. `card_statement` unique por tarjeta y período).
- **D4 · Una tarjeta genera dos compromisos por mes**: moneda local y USD. Cada compromiso tiene una sola moneda.
- **D5 · Postergar mueve `period`; nunca `origin_period`.** Pago parcial + postergar el resto divide: la fila original queda pagada por lo pagado y nace una hija (`parent_commitment_id`) con el resto.
- **D6 · Los meses son fechas** con día 1 (check en la base).
- **D7 · Periodicidad = `every_months` + `anchor_month`.** Mensual 1; anual en marzo 12/3.
- **D8 · La simulación no tiene tablas**: se calcula en memoria con la operación hipotética del request.

**Formatos de `source_key`**: `is:<id>:<period>` (ingreso) · `re:<id>:<period>` (recurrente) · `cc:<id>:<period>:<currency>` (tarjeta) · `oe:<id>:<n>` (gasto puntual) · `ln:<id>:<n>` (préstamo).

**Préstamos**: al darlo de alta se cargan sus condiciones (sistema francés/alemán/americano, TNA, IVA sobre intereses, seguro, cuotas, capital; en UVA, capital en UVAs). El dominio calcula el cuadro teórico, que **no se guarda**. Mes a mes solo se carga el importe real de la cuota. Desvío = real − teórica. Deuda remanente = saldo de capital teórico.

**IPC**: se guarda el **nivel** del índice de cada mes, no la variación.

## Tests

- Sin tests en verde no se integra.
- `packages/domain`: tests unitarios puros, rápidos, con casos borde. Cada regla de negocio y cada decisión D1–D8 tiene al menos un test.
- Casos de uso con base: Vitest contra Postgres real en memoria con **PGlite** (`@electric-sql/pglite` + `drizzle-orm/pglite`), aplicando las mismas migraciones. Sin Docker.
- Obligatorios (RNF-11): proyección, generación de cuotas, cuadros de amortización (contra cuadros reales de los dos préstamos), cotizaciones (incluida la retroactiva), postergaciones y divisiones, redondeos, apertura de mes idempotente, middleware de auth.
- Primero la lógica con sus tests; la pantalla va encima cuando los números dan bien.

## Flujo de trabajo

- `main` = producción (lo que está desplegado). `develop` = integración. Trabajo en ramas `feat/…`, `fix/…` que salen de `develop`.
- `main` y `develop` están protegidas por un ruleset de GitHub: solo se entra por PR, y el PR no se puede mergear si no pasa el job `verify` del CI (`.github/workflows/ci.yml`: tipos, tests, migraciones al día con el schema, build del Worker y de la PWA). No se aceptan push directos ni force push.
- Commits chicos, en inglés, con prefijo: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`.
- No hacer push, merge a `main` ni deploy sin que Martín lo pida. Mergear a `main` es desplegar.
- Comandos que requieren credenciales (`wrangler login`, `wrangler secret put`, `wrangler hyperdrive create`, migraciones contra Supabase, deploy) los corre Martín. Prepará el comando exacto y explicá qué hace.
- Al terminar una tarea, decí en una o dos líneas qué quedó hecho y qué sigue. Sin resúmenes largos.

## Fuera de alcance (no implementar aunque parezca útil)

Cuentas bancarias, saldos, transferencias, efectivo · gastos chicos del día a día · quién pagó qué (todo es bolsa común) · avisos de vencimiento · adjuntar archivos (RF-36, futuro) · histórico previo a la puesta en marcha.

## E0 — checklist

Detalle en `docs/plan-de-entregas.md`.

- [x] Monorepo pnpm con `apps/web`, `apps/worker`, `packages/domain`, `packages/db`; TypeScript estricto; `.gitignore` (incluye `.dev.vars`, `.env*`, `node_modules`).
- [x] Schema Drizzle completo (las 21 tablas de `docs/modelo-de-datos.md`) y primera migración.
- [x] Worker con Hono, `nodejs_compat`, binding de Hyperdrive, middleware de auth, ruta `GET /api/me`.
- [x] PWA mínima: login con Google (Supabase Auth) y pantalla que muestra el nombre leído vía `GET /api/me`.
- [x] Seed de `person`: Martín y Rosalía (usuarios), Amaia (no usuaria). Los mails salen de `packages/db/.env`, no del repo.
- [x] Vitest configurado; tests del middleware de auth (token válido, vencido, mail fuera de lista).
- [x] Script de backup semanal (`pg_dump`) para el Programador de tareas de Windows, que guarda en una carpeta sincronizada con OneDrive (RNF-12).
- [x] Guía `docs/setup.md` con los pasos y comandos que corre Martín (Hyperdrive, secretos, migración, deploy).
- [x] Cierre: login desde el celular → "Hola, Martín". Un mail no autorizado recibe 403.

Notas de implementación de E0:
- Textos de pantalla que no son tablas ni enums: sección `ui:` de `docs/glosario-es.yml`, vía `t()` de `apps/web/src/glossary.ts`.
- La app del Worker se arma con `createApp({ db, verifier })`: en producción Hyperdrive + JWKS de Supabase; en tests PGlite + claves locales.
- Hyperdrive con caché desactivada (`--caching-disabled`): si no, las lecturas pueden venir viejas hasta 60 s después de una escritura.

A verificar al armar Hyperdrive: la conexión directa de Supabase en plan free puede ser solo IPv6. Si falla, usar el *Session pooler* (puerto 5432), no el *Transaction pooler* (6543).
