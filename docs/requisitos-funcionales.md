# Requisitos — Sistema de economía familiar

Oct 1, 2026 · @Martín Ramallo

## Objetivo y alcance

El sistema es una herramienta de planificación mensual: muestra cuánto entra y cuánto hay que pagar cada mes, hoy y a varios meses vista, para decidir si entra una compra en cuotas o un crédito nuevo. No es un sistema contable ni un flujo de caja.

**Incluye**

- Ingresos por fuente, con vigencia indefinida o por período.
- Compromisos de pago: resúmenes de tarjetas, servicios, gastos recurrentes, cuotas de préstamos, impuestos y expensas de propiedades, gastos puntuales agendados.
- Seguimiento del estado de cada compromiso (pagado, pendiente, postergado).
- Proyección a futuro y simulación de nuevas cuotas o créditos.
- Costo financiero: intereses, gastos administrativos e impuestos de tarjetas y préstamos.
- Carga automática de comprobantes por Claude y carga manual.

**No incluye**

- Saldos de cuentas bancarias, billeteras o efectivo, ni transferencias entre ellas.
- Gastos chicos del día a día (solo rubros grandes estimados, como súper mensual o nafta).
- Arrastre del sobrante de un mes al siguiente.
- Distinción de quién pagó qué: todo va a una bolsa común.
- Avisos de vencimiento (por ahora).

## Conceptos clave

**Compromiso de pago.** Es la unidad central del sistema: algo que hay que pagar en un mes dado. Cada mes el sistema genera los compromisos a partir de tarjetas, servicios, recurrentes, préstamos, propiedades y gastos puntuales. Tiene un monto estimado y, cuando se conoce, un monto real.

**Estados del compromiso.** Pendiente, Pagado, Pagado parcial, Postergado y Anulado. Postergar mueve el compromiso a otro mes; pagar parcial deja el resto pendiente o lo posterga.

**Ingreso esperado.** Es el equivalente del compromiso del lado de los ingresos: se genera por mes desde cada fuente y se marca como Cobrado cuando entra, con el monto real.

**Resultado mensual.** Ingresos del mes − compromisos del mes. No se arrastra: cada mes arranca en cero. Se muestra en dos versiones: el estimado (para meses futuros) y el real (para meses cerrados).

**Monedas.** Cada importe se guarda en su moneda original (ARS, USD o UYU) con la cotización de su fecha. Los totales se muestran en ARS y en USD.

**Pesos constantes.** Opcionalmente, los montos en ARS se expresan ajustados por IPC para comparar meses.

*[Diagrama: ciclo de vida del compromiso · 5 estados — ver versión online]*

Un compromiso nace Pendiente; postergarlo lo devuelve a Pendiente en otro mes, así que nada se pierde de vista hasta que se paga o se anula.

## Entidades

Once entidades cubren todo lo relevado; el Compromiso y el Ingreso esperado son las que se generan mes a mes a partir de las demás.

| Entidad | Qué guarda | Casos actuales |
| --- | --- | --- |
| Persona | Titular informativo de tarjetas, préstamos e ingresos; usuarios del sistema | Martín, Rosalía (usuarios); Amaia (destinataria de la mesada) |
| Fuente de ingreso | Tipo, titular, moneda, monto estimado, frecuencia, vigencia (indefinida o desde/hasta), historial de montos con mes de vigencia | Sueldos docentes y de tutoría, FinEs, Alianza, Liceo, proyectos de Adavra, 3 alquileres, extras |
| Tarjeta | Banco, país, titular, día de cierre y de vencimiento | 4 Banco Provincia + 1 de Uruguay |
| Resumen de tarjeta | Mes, totales ARS/USD, mínimo, saldo anterior, monto pagado, saldo financiado | Uno por tarjeta y mes |
| Movimiento de tarjeta | Tipo (consumo, cuota n de N, suscripción o débito automático, interés, gasto administrativo, impuesto), moneda, monto | Ej.: celular de Ro como débito automático |
| Servicio | Proveedor, propiedad asociada, monto estimado, pago mensual o anual | Agua, luz, gas, celulares, ARBA, APR (Agencia Platense de Recaudación) |
| Gasto recurrente | Concepto, monto, periodicidad, vigencia; solo los que se pagan fuera de tarjeta | Mesada de Amaia, gimnasio, clases particulares |
| Gasto estimado | Rubro grande del mes con monto estimado y real opcional | Supermercado mensual, nafta |
| Gasto puntual | Descripción, categoría, monto, fecha prevista (puede ser futura), cuotas opcionales, propiedad asociada opcional | Reparaciones grandes de la casa |
| Préstamo | Entidad, titular, moneda, capital, tipo (tasa fija o UVA), sistema de amortización, TNA, IVA sobre intereses, seguro, cantidad de cuotas, primera cuota; cuadro de amortización teórico calculado | Uno de Martín y uno de Rosalía, en pesos |
| Propiedad | Nombre, país, moneda; vínculo con su alquiler, impuestos y expensas | 2 en Uruguay, 1 en Argentina |

Transversales: **Categoría**, **Cotización** (USD/ARS y UYU/USD por fecha), **IPC** mensual (nivel del índice) y, a futuro, **Comprobante** (archivo adjunto a cualquier registro).

## Requisitos funcionales

Son 36 requisitos; 31 son imprescindibles para una primera versión que ya reemplace la planilla.

| ID | Módulo | Requisito | Prioridad |
| --- | --- | --- | --- |
| RF-01 | General | Dos usuarios (Martín y Rosalía) con los mismos permisos; cada registro guarda quién lo cargó y quién lo modificó. | Imprescindible |
| RF-02 | General | Bolsa común: la persona es un dato informativo (titular); no se calcula quién pagó ni quién le debe a quién. | Imprescindible |
| RF-03 | General | Cada importe se guarda en ARS, USD o UYU; los totales se muestran en ARS y en USD. | Imprescindible |
| RF-04 | General | Cargar a mano la cotización del dólar oficial (USD/ARS) y la de UYU/USD, con fecha desde la que rige (puede ser anterior a la carga); rige hasta que se carga otra. | Imprescindible |
| RF-05 | General | Cargar a mano el nivel del IPC de cada mes y mostrar montos en pesos constantes. | Deseable |
| RF-06 | General | Categorías configurables para ingresos y gastos. | Imprescindible |
| RF-07 | Ingresos | Alta de fuente de ingreso con tipo, titular, moneda, monto, frecuencia y vigencia indefinida o con fecha de fin. El monto se mantiene hasta que se carga una actualización con su mes de vigencia (sueldos, alquileres); se guarda el historial. | Imprescindible |
| RF-08 | Ingresos | Generar el ingreso esperado de cada mes y registrar el monto real cobrado. | Imprescindible |
| RF-09 | Ingresos | Registrar ingresos puntuales (extras, proyectos de Adavra, suplencias) con fecha esperada. | Imprescindible |
| RF-10 | Tarjetas | Alta de tarjeta con banco, país, titular, día de cierre y día de vencimiento. | Imprescindible |
| RF-11 | Tarjetas | Registrar el resumen mensual: totales ARS y USD, pago mínimo, saldo anterior y vencimiento. | Imprescindible |
| RF-12 | Tarjetas | Desglosar el resumen en movimientos por tipo: consumo, cuota, suscripción o débito automático, interés, gasto administrativo, impuesto. | Imprescindible |
| RF-13 | Tarjetas | Proyectar cada compra en cuotas en los resúmenes futuros hasta su última cuota. | Imprescindible |
| RF-14 | Tarjetas | Proyectar suscripciones y débitos automáticos en los resúmenes futuros hasta darlos de baja. | Imprescindible |
| RF-15 | Tarjetas | Registrar el pago del resumen en su moneda de pago (ARS en las tarjetas argentinas, UYU en la uruguaya), incluida la parte en USD con su cotización; si es menor al total, el saldo pasa al resumen siguiente. | Imprescindible |
| RF-16 | Tarjetas | Estimar el resumen de meses futuros (cuotas + suscripciones + consumo estimado) y reemplazarlo por el real al cargarlo. | Imprescindible |
| RF-17 | Servicios | Alta de servicio o impuesto con proveedor, propiedad asociada, monto estimado y modalidad de pago: mensual (o la periodicidad que corresponda) o anual, con su mes de pago. | Imprescindible |
| RF-18 | Recurrentes | Alta de gasto recurrente pagado fuera de tarjeta, con monto, periodicidad y vigencia. | Imprescindible |
| RF-19 | Servicios | Al cargar la factura real, reemplazar la estimación del mes y actualizar la de los meses siguientes. | Deseable |
| RF-20 | Gastos | Cargar gastos estimados de rubros grandes (súper, nafta) por mes, con monto real opcional. | Imprescindible |
| RF-21 | Gastos | Alta de gasto puntual con descripción, categoría, monto, fecha prevista (puede ser futura), cuotas opcionales y propiedad asociada opcional. | Imprescindible |
| RF-22 | Préstamos | Alta de préstamo con entidad, titular, moneda, capital (y capital en UVAs si es UVA), tipo (tasa fija o UVA), sistema de amortización (francés, alemán o americano), TNA, TEA y CFT informados, IVA sobre intereses, seguro mensual, fecha de otorgamiento, cantidad de cuotas y primera cuota. | Imprescindible |
| RF-23 | Préstamos | Calcular el cuadro de amortización teórico y generar las cuotas hasta la última con la cuota teórica como estimada; registrar la cuota real y la diferencia contra la teórica. | Imprescindible |
| RF-24 | Préstamos | En préstamos UVA, reestimar las cuotas futuras con el último valor de UVA conocido. | Deseable |
| RF-25 | Préstamos | Mostrar cuotas pagadas, cuotas restantes, fecha de fin y saldo de capital según el cuadro teórico. | Imprescindible |
| RF-26 | Propiedades | Alta de propiedad vinculada a su alquiler, impuestos, expensas, servicios y gastos puntuales. | Imprescindible |
| RF-27 | Compromisos | Generar automáticamente los compromisos de cada mes desde todas las entidades. | Imprescindible |
| RF-28 | Compromisos | Cambiar el estado de un compromiso: Pagado (monto, fecha, medio de pago), Pagado parcial, Postergado (a qué mes) o Anulado. | Imprescindible |
| RF-29 | Compromisos | Registrar el recargo o interés generado por postergar o pagar parcial. | Deseable |
| RF-30 | Compromisos | Vista del mes: ingresos esperados y cobrados, compromisos por estado, resultado estimado y real. | Imprescindible |
| RF-31 | Planificación | Proyección del resultado mensual estimado a N meses (12 por defecto). | Imprescindible |
| RF-32 | Planificación | Simulador: cargar una operación hipotética (compra en cuotas, préstamo, gasto recurrente), ver su impacto sin guardarla y poder confirmarla. | Imprescindible |
| RF-33 | Planificación | Indicador del porcentaje del ingreso mensual comprometido en cuotas y préstamos. | Imprescindible |
| RF-34 | Carga | Carga y edición manual de todos los registros. | Imprescindible |
| RF-35 | Carga | Carga automática por Claude a partir de comprobantes (ver sección siguiente). | Imprescindible |
| RF-36 | Carga | Adjuntar el comprobante a cualquier registro. | Futuro |

## Carga automatizada con Claude

Claude carga los comprobantes con montos que cambian cada mes; el resto se carga a mano. El sistema necesita una vía de escritura para Claude (MCP o API sobre la base) y una bandeja de revisión, porque la extracción va a equivocarse a veces.

**Comprobantes que carga Claude:** resúmenes de tarjetas, facturas de servicios (luz, gas, agua, celulares, ARBA), avisos o débitos de cuotas de préstamos (solo el importe total), liquidaciones de impuestos y expensas de las propiedades.

**Flujo**

1. Martín o Rosalía dejan el archivo (PDF o imagen) en una carpeta de entrada.
2. Claude lo lee, identifica de qué se trata (qué tarjeta, servicio, préstamo o propiedad) y extrae período, vencimiento, montos y monedas.
3. Si es un resumen de tarjeta, desglosa cada movimiento por tipo y reconoce las cuotas (n de N) y suscripciones ya proyectadas.
4. Busca el compromiso del mes que corresponde y arma la operación a ejecutar (cargarle el monto real, o crear uno nuevo si no existe), sin aplicarla todavía.
5. Deja el comprobante **A revisar** con esa operación propuesta.
6. Un usuario revisa y confirma, o corrige los datos antes de confirmar. Recién al confirmar se aplica la operación.
7. El archivo se mueve a una carpeta de procesados.

**Requisitos de la carga automática**

- Cada registro guarda su origen: manual o automático, y el nombre del archivo del que salió (el archivo no se guarda en el sistema).
- Detección de duplicados: el mismo comprobante subido dos veces no genera dos registros.
- Factura y comprobante de pago son dos documentos del mismo compromiso: el segundo marca el pago, no crea otro gasto.
- Si Claude no reconoce la entidad (por ejemplo, una tarjeta nueva), no inventa: deja el comprobante en la bandeja con el motivo.
- Bandeja de revisión con lo pendiente de confirmar.

## Reportes

El reporte principal es la proyección a 12 meses; los demás explican de dónde sale ese número.

| Reporte | Qué responde |
| --- | --- |
| Proyección mensual | ¿Cuánto entra, cuánto sale y qué resultado queda en cada uno de los próximos N meses? |
| Simulación | ¿Cómo queda la proyección si sumo esta compra en cuotas o este préstamo? |
| Compromisos futuros por tipo | ¿Qué cuotas, préstamos y suscripciones tengo, cuánto suman por mes y en qué mes termina cada uno? |
| Carga de cuotas | ¿Qué porcentaje del ingreso se va en cuotas y préstamos, hoy y en los próximos meses? |
| Costo financiero de tarjetas | ¿Cuánto pagamos de intereses por no pagar el total, gastos administrativos e impuestos, por tarjeta y por mes? |
| Gasto por categoría | ¿En qué se va la plata cada mes? |
| Comparativa mes a mes | ¿Gastamos más o menos que antes, en pesos corrientes y ajustado por inflación? |
| Rentabilidad por propiedad | ¿Cuánto deja cada propiedad: alquiler menos impuestos, expensas, servicios y gastos puntuales (reparaciones)? |
| Estado del mes | ¿Qué está pagado, qué falta y qué se postergó? |
| Préstamos | ¿Cuántas cuotas quedan, cuándo terminan, cuánto capital se debe y cuánto se desvía la cuota real de la teórica? |

## Reglas de negocio

1. **Sin doble conteo.** Lo que se paga con tarjeta (suscripciones, débitos automáticos como el celular de Ro, consumos) vive solo dentro del resumen; el compromiso es el pago del resumen. Los gastos recurrentes son únicamente los que se pagan fuera de tarjeta.
2. **Recurrente pagado con tarjeta.** Si un recurrente se paga alguna vez con tarjeta, ese mes queda como consumo del resumen y no como recurrente.
3. **Moneda de pago de las tarjetas.** Las argentinas se pagan en ARS y la uruguaya en UYU, incluido el saldo en USD; se registra la cotización aplicada.
4. **Pago parcial de tarjeta.** Lo no pagado pasa como saldo al resumen siguiente; los intereses que genera se registran como costo financiero.
5. **Moneda original.** Ningún importe se convierte al guardarlo; la conversión se hace al mostrar. Lo de Uruguay se guarda en UYU o USD según el comprobante y se muestra en USD y ARS.
6. **Cotización vigente.** Cada importe se convierte con la cotización vigente a su fecha: la última cargada con fecha de inicio igual o anterior. Una cotización cargada con fecha retroactiva recalcula estimaciones y montos convertidos desde esa fecha, pero nunca los pagos ya hechos: cada pago guarda la cotización que se aplicó realmente y queda fijo.
7. **Montos vigentes.** Sueldos, alquileres y demás ingresos se mantienen constantes hasta que se carga una actualización con su mes de vigencia; la proyección usa el nuevo monto desde ese mes.
8. **Impuestos anuales.** Un impuesto marcado como anual genera un único compromiso en su mes de pago, no uno por mes.
9. **Sin arrastre.** El resultado de un mes no pasa al siguiente. Lo que sí pasa son los compromisos postergados.
10. **Estimado contra real.** Todo compromiso futuro es estimado; al cargarse el comprobante, el monto real reemplaza al estimado y se guarda la diferencia.
11. **Fin automático.** Las cuotas, préstamos e ingresos con fecha de fin dejan de proyectarse solos al llegar a su última cuota o fecha.
12. **Confirmación humana.** Lo que carga Claude queda como operación propuesta A revisar y no toca ningún dato (ni reportes ni proyección) hasta que un usuario la confirma.

## Requisitos no funcionales

Todo corre en planes gratuitos: PWA en Cloudflare Pages, un único Cloudflare Worker con la API y el MCP, y Supabase solo como Postgres y login con Google. La lógica de negocio vive entera en el Worker, en TypeScript.

*[Diagrama: arquitectura · todo en planes free — ver versión online]*

La PWA y el Claude de cada usuario entran por el mismo Worker, así que las reglas de negocio se aplican igual sin importar quién carga.

| ID | Categoría | Requisito |
| --- | --- | --- |
| RNF-01 | Plataforma | Web responsive instalable (PWA), usable desde celular y computadora. |
| RNF-02 | Front | React + Vite, alojado en Cloudflare Pages (plan free, subdominio pages.dev). Habla solo con el Worker, nunca directo con la base. |
| RNF-03 | Back | Un Cloudflare Worker (plan free, subdominio workers.dev) en TypeScript con Hono y compatibilidad Node, que expone la API REST de la PWA y el servidor MCP remoto; ambos comparten el mismo código de dominio. |
| RNF-04 | Base de datos | Supabase Postgres, plan free. El Worker se conecta directo vía Hyperdrive y node-postgres, no por la API REST de Supabase. |
| RNF-05 | Acceso a datos | Drizzle ORM; schema en TypeScript y migraciones con drizzle-kit versionadas en el repositorio. Nada se cambia a mano en el panel de Supabase. |
| RNF-06 | Lógica de negocio | Toda en el Worker, en TypeScript. Las escrituras que tocan varias tablas (cargar resumen, marcar pago, postergar, confirmar lo cargado por Claude) corren en una transacción. |
| RNF-07 | Autenticación | Login con Google vía Supabase Auth. La PWA envía un Bearer token; un middleware único del Worker verifica la firma del JWT y que el mail esté en la lista blanca (Martín y Rosalía). Sin doble factor. |
| RNF-08 | MCP | Autenticado con OAuth de Google, para que cada uno use su propio Claude y quede registrado quién cargó qué. Las herramientas son operaciones del dominio (por ejemplo, load_card_statement o record_utility_bill); no hay SQL libre. |
| RNF-09 | Protección de la base | RLS activado y sin políticas en todas las tablas, para que la API pública de Supabase no exponga nada aunque se filtre la clave. |
| RNF-10 | Importes | Montos en numeric(14,2) y cotizaciones en numeric(14,6). En TypeScript se operan con decimal.js; prohibido usar number para dinero. |
| RNF-11 | Calidad | Tests automáticos con Vitest sobre proyección, cuotas, cuadros de amortización (francés, alemán, americano y UVA), cotizaciones, postergaciones, redondeos y el middleware de autenticación; las transacciones se prueban contra una base de test. Sin tests en verde no se integra. |
| RNF-12 | Respaldo | Script semanal en la compu de Martín (Programador de tareas de Windows) que corre pg_dump y guarda el archivo en una carpeta local sincronizada con OneDrive. El mismo script evita que Supabase pause el proyecto por inactividad. |
| RNF-13 | Límites a vigilar | Worker: 3 MB comprimido (la prueba con Drizzle + MCP dio 342 KB), 10 ms de CPU por request, 100.000 requests y 100.000 consultas por día. Supabase: 500 MB de base y pausa a los 7 días sin uso. |
| RNF-14 | Comprobantes | Cada usuario deja los comprobantes en una carpeta de su computadora y le pide a su Claude que los procese; no hay procesamiento programado. |
| RNF-15 | Puesta en marcha | Sin histórico: se carga la situación actual. Cuotas pendientes de cada tarjeta (Claude las toma del último resumen), préstamos con sus condiciones y cuotas restantes, ingresos vigentes y servicios. |
| RNF-16 | Desarrollo | Proyecto personal. Stack JavaScript/TypeScript; lo programa Claude con supervisión de Martín. |
| RNF-17 | Nombres | Base de datos, código y herramientas MCP en inglés. Los textos de la interfaz, en castellano, salen de un glosario YAML (`docs/glosario-es.yml`) con la traducción de cada tabla, campo y valor de enum. |

## Preguntas abiertas

No quedan preguntas abiertas de requisitos. Próximo paso: modelo de datos (ver `docs/modelo-de-datos.md`) y plan de entregas de los 31 imprescindibles.

Resueltas el 1/10: dólar oficial con cotización manual y vigencia desde una fecha; tarjeta uruguaya pagada en UYU; lo cargado por Claude no cuenta hasta revisarse; alquileres y sueldos se actualizan a mano con mes de vigencia; impuestos marcados como mensuales o anuales; IPC cargado a mano; APR es la Agencia Platense de Recaudación.

Resueltas el 2/10: PWA; Supabase free con login de Google; todo en un Cloudflare Worker free con Drizzle (descartados Render por las demoras al despertar y Prisma por peso y límites del plan free); Bearer token; numeric + decimal.js; tests automáticos; backup propio semanal; sin histórico.

Resueltas el 2/10 (2): front con React + Vite; back en TypeScript con Hono sobre el Worker; subdominios gratuitos de Cloudflare; backup local con script semanal.

Resueltas el 2/10 (3): el IPC se carga como nivel del índice de cada mes, no como variación; los préstamos guardan tasa y sistema de amortización para calcular el cuadro teórico; mes a mes solo se carga el importe real de la cuota y se compara contra la teórica, sin desglose por componente.

Resueltas el 2/10 (4): modelo de datos validado (`docs/modelo-de-datos.md`). Servicios, gastos recurrentes y gastos estimados se modelan como una sola entidad con clase; lo que carga Claude se guarda como operación propuesta y se aplica al confirmar; nombres técnicos en inglés con glosario en castellano.
