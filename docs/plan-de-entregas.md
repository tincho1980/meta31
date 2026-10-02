# Plan de entregas — Sistema de economía familiar

2 oct 2026 · Base: `requisitos-funcionales.md` y `modelo-de-datos.md`

Cinco entregas. Cada una deja algo que se usa de verdad; ninguna depende de la siguiente para tener sentido. La meta es cerrar **E1 y E2** (la base), después **E3** (Claude carga) y por último **E4** (análisis).

| Entrega | Objetivo | Se usa para | Criterio de cierre |
| --- | --- | --- | --- |
| E0 · Esqueleto | Toda la arquitectura funcionando de punta a punta, sin dominio | Nada todavía: elimina el riesgo técnico | Login con Google desde el celular y un dato leído de Supabase a través del Worker, en producción |
| E1 · Planificar | Cargar todo lo que genera compromisos y ver el mes y los 12 siguientes | Reemplazar la planilla para planificar | Se planifica el mes sin abrir la planilla |
| E2 · Operar | Registrar lo que pasa: pagos, cobros, postergaciones, montos reales | Llevar el mes al día | La planilla se archiva |
| E3 · Claude carga | MCP, bandeja de comprobantes, duplicados | Dejar de tipear resúmenes y facturas | Un mes completo cargado desde comprobantes |
| E4 · Análisis | Simulador, IPC, rentabilidad, comparativas, UVA | Decidir compras y créditos | Cuando se cierre (no hay apuro) |

## Decisiones del plan

1. **El schema se crea completo en E0/E1.** Las 21 tablas ya están validadas y la columna de auditoría `source_document_id` apunta a `source_document`, que es de E3. Crear todo en la primera migración evita reacomodar claves foráneas después. Lo que se entrega por partes son las funciones, no las tablas.
2. **Las cotizaciones (RF-04) pasan a E1.** Sin ellas la proyección no puede sumar los alquileres de Uruguay con los sueldos en pesos. En el borrador estaban en "operar"; era un error.
3. **La carga inicial (RNF-15) no se hace a mano.** Al cierre de E1, Claude (en Cowork, sin MCP) lee los últimos resúmenes y avisos y arma un archivo de carga (JSON) que un script del repo importa por la misma capa de dominio. Es tirar código, pero ahorra horas de tipeo y prueba el dominio con datos reales.
4. **El desglose de resúmenes (RF-12) entra en E2, pero solo para lo financiero.** A mano se cargan intereses, gastos administrativos e impuestos (pocas líneas, alimentan el costo financiero). El desglose completo de consumos se vuelve práctico recién con Claude en E3.
5. **Primero lógica y tests, después pantallas.** En E1 y E2, cada función del dominio existe primero con sus tests en Vitest; la pantalla va encima cuando los números dan bien.

## E0 · Esqueleto

**Alcance**
- Repo monorepo con pnpm: `apps/web` (React + Vite, PWA), `apps/worker` (Hono), `packages/domain` (lógica pura, sin I/O), `packages/db` (schema Drizzle y migraciones).
- Proyecto Supabase free con login de Google; Hyperdrive apuntando a la base.
- Middleware de autenticación: verifica el JWT y la lista blanca (RNF-07). Tabla `person` con Martín y Rosalía.
- Deploy en Cloudflare Pages y Workers (subdominios gratuitos).
- RLS activado sin políticas (RNF-09).
- Script de backup semanal con `pg_dump` en la compu de Martín (RNF-12). Va acá porque además evita que Supabase pause el proyecto.
- Vitest configurado, con una base de test para lo transaccional.

**Tests:** middleware de autenticación (token válido, vencido, mail fuera de la lista).

**Cierre:** desde el celular, login con Google → la PWA muestra "Hola, Martín" leído de `person` vía Worker. Un mail no autorizado recibe 403.

## E1 · Planificar

**Requisitos**

| Módulo | Requisitos |
| --- | --- |
| General | RF-01 (auditoría), RF-02, RF-03, RF-04, RF-06 |
| Ingresos | RF-07, RF-08 (solo generar el esperado), RF-09 |
| Tarjetas | RF-10, RF-11 (resumen con totales), RF-13, RF-14, RF-16 |
| Gastos | RF-17, RF-18, RF-20, RF-21 |
| Préstamos | RF-22, RF-23 (solo generar cuotas teóricas), RF-25 |
| Propiedades | RF-26 (alta y vínculos) |
| Compromisos | RF-27, RF-30 (versión estimada) |
| Planificación | RF-31, RF-33 |
| Carga | RF-34 (alta y edición de todo lo anterior) |

**Dominio (packages/domain), en este orden**
1. Períodos y periodicidad (D6, D7): sumar meses, ¿toca en este mes?
2. Montos vigentes (regla 7) y cotización vigente (regla 6); conversión a ARS y USD.
3. Cuadro de amortización: francés, alemán, americano. UVA queda calculado en UVAs con el último valor cargado a mano.
4. Generadores de candidatos por regla: fuentes de ingreso, gastos recurrentes, gastos puntuales, préstamos, tarjetas (cuotas + suscripciones + consumo estimado, o resumen real).
5. Unión de virtual + grabado por `source_key` (D1) y apertura idempotente del mes.
6. Proyección a N meses y porcentaje comprometido en cuotas y préstamos.

**Pantallas**
- Altas: fuentes de ingreso, tarjetas, compras en cuotas, suscripciones, gastos recurrentes, gastos puntuales, préstamos, propiedades, categorías, cotizaciones.
- Vista del mes (estimada).
- Proyección a 12 meses, con el indicador de carga de cuotas.

**Reportes:** Proyección mensual · Compromisos futuros por tipo · Carga de cuotas.

**Tests:** periodicidad y bordes (fin de vigencia, mes ancla), cambio de monto con mes de vigencia, cotización retroactiva, cuadros de amortización contra los cuadros reales de los dos préstamos, cuotas de tarjeta que terminan en el horizonte, apertura de mes repetida sin duplicar, redondeo de cuotas de gasto puntual.

**Puesta en marcha:** carga inicial con el script de importación (decisión 3).

**Cierre:** la proyección del mes en curso coincide con la planilla (o la diferencia se explica), y se planifica el mes siguiente solo con el sistema.

## E2 · Operar

**Requisitos**

| Módulo | Requisitos |
| --- | --- |
| Ingresos | RF-08 (registrar el cobro real) |
| Tarjetas | RF-12 (intereses, gastos administrativos e impuestos), RF-15 |
| Servicios | RF-19 (deseable) |
| Préstamos | RF-23 (cuota real y desvío contra la teórica) |
| Compromisos | RF-28, RF-29 (deseable), RF-30 (versión real) |
| Carga | RF-34 (edición de pagos y estados) |

**Dominio**
1. Registrar pago: imputación, cotización aplicada fija, cálculo de estado (paid / partially_paid), en transacción.
2. Postergar y dividir (D5).
3. Pago de tarjeta en moneda local que cubre la parte USD; saldo no pagado que pasa como saldo anterior del resumen siguiente (regla 4).
4. Anular un recurrente pagado con tarjeta (regla 2).
5. Cargar monto real (factura, resumen, cuota) y, para servicios, actualizar la estimación de los meses siguientes (RF-19).
6. Cerrar el mes: resultado real definitivo.

**Pantallas**
- Vista del mes operable: marcar cobrado, pagar, pagar parcial, postergar, anular, cargar monto real.
- Pago de resumen de tarjeta (dos monedas).
- Ficha de préstamo con cuotas, desvíos y deuda remanente.

**Reportes:** Estado del mes · Costo financiero de tarjetas · Préstamos · Gasto por categoría.

**Tests:** pago parcial + postergación del resto, postergar dos veces, pago en ARS de un compromiso en USD con cotización distinta a la vigente, saldo de tarjeta que pasa al resumen siguiente, cotización retroactiva que no altera pagos hechos, anulación de recurrente por pago con tarjeta, cierre de mes.

**Cierre:** un mes entero llevado en el sistema, con resultado real cerrado. La planilla se archiva.

## E3 · Claude carga

**Requisitos:** RF-35, RF-12 completo (todos los movimientos), regla 12, RNF-08, RNF-14.

**Alcance**
- Servidor MCP remoto en el mismo Worker, con OAuth de Google.
- Herramientas del dominio: `load_card_statement`, `record_utility_bill`, `record_loan_installment`, `record_tax`, `record_condo_fee`, `register_payment`, más lectura (tarjetas, servicios, préstamos y propiedades, para que Claude identifique la entidad).
- `source_document`: operación propuesta, detección de duplicados por hash y por clave natural (tarjeta + período), estados de la bandeja.
- Bandeja de revisión en la PWA: ver la operación propuesta, corregir, confirmar o descartar.
- Instrucciones para el Claude de cada uno: carpeta de entrada, carpeta de procesados, qué hacer si no reconoce la entidad.

**Tests:** confirmar aplica la operación en transacción; descartar no deja rastros; mismo archivo dos veces; resumen ya cargado a mano; comprobante de pago sobre factura existente; entidad no reconocida.

**Cierre:** un mes completo cargado desde comprobantes, revisado en la bandeja.

## E4 · Análisis

**Requisitos:** RF-05 (IPC y pesos constantes), RF-24 (reestimación UVA automática), RF-32 (simulador).

**Reportes:** Simulación · Comparativa mes a mes · Rentabilidad por propiedad.

Sin fecha. Se arma cuando E1–E3 estén estables y haya meses reales con qué comparar.

## Fuera del plan

- RF-36 (adjuntar comprobantes): futuro.
- Avisos de vencimiento: fuera de alcance por ahora.

## Cobertura

Los 36 requisitos quedan asignados: 30 de los 31 imprescindibles en E1–E3; los deseables RF-19 y RF-29 en E2; RF-05, RF-24 y el imprescindible RF-32 en E4; RF-36 fuera. RF-08, RF-23 y RF-30 se parten entre E1 (generar o estimar) y E2 (registrar lo real). RF-32 es imprescindible según los requisitos, pero queda en E4 por decisión del 2/10.
