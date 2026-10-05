# Meta31

Llegar al 31 con lo que queda.

Meta31 es el sistema de finanzas de la casa de Martín y Rosalía. El nombre sale de un chiste de todos los meses: la meta es llegar al día 31. Ese chiste es el concepto de toda la marca: **el mes es un camino y el 31 es la meta**. Cada pantalla responde primero una sola pregunta: *¿con cuánto llegamos al 31?*

Lo usan dos personas, desde el celular y desde la compu. No es un banco ni una fintech: es la libreta de la casa, bien hecha.

## Principios

1. **El número es el protagonista.** El monto principal va grande, en Fraunces y con cifras tabulares. Todo lo demás está para explicarlo.
2. **El color fuerte se gana.** La interfaz es verde, papel y arena. El girasol marca solo la meta y la acción principal. El terracota solo aparece cuando algo se corrió.
3. **El estado se lee por la forma, no por el color.** Los cuatro glifos (vacío, medio lleno, punteado, lleno) se distinguen en blanco y negro. El color refuerza, pero no carga solo la información.
4. **Calma, no alarma.** Nada titila y no hay rojo de emergencia. Un mes ajustado se muestra en terracota y con texto claro, no con sirenas.
5. **Hablamos como en casa.** "Llegás al 31 con", "lo pasaste al 15", "listo el 1". Nada de "transacción" ni "egreso devengado".

## Logotipo

El logotipo es tipográfico, no hay un archivo de imagen: **Meta** en Fraunces 600 y **31** en Fraunces itálica 400, en girasol, encerrado con un trazo a mano, como un día marcado con birome en el almanaque de la cocina.

- Sobre verde-casa: "Meta" en crema y el 31 con su trazo en girasol (es la versión principal).
- Sobre papel: "Meta" en tinta y el 31 con su trazo en verde-casa. El girasol no contrasta sobre papel.
- Se escribe **Meta31**, todo junto, con M mayúscula. Nunca "META 31" ni "meta31" en un texto.
- El trazo es siempre el mismo dibujo (ver el componente Logotipo). No se redibuja ni se reemplaza por un círculo perfecto.

## Color

| Rol | Token | Para qué |
| --- | --- | --- |
| Marca | `verde-casa` | Encabezado del mes, barra lateral, glifos |
| Meta | `girasol` | El 31, el día de hoy, la bandera, el botón Cargar |
| Fondo | `papel` | Fondo de página |
| Superficies | `arena`, `arena-2` | Filas y tarjetas |
| Texto | `tinta`, `tinta-suave` | Sobre papel y arena |
| Texto sobre verde | `crema`, `salvia`, `salvia-2` | En ese orden de jerarquía |
| Señales | `terracota`, `terracota-texto` | Postergado y saldo negativo |
| Ingresos | `verde-ingreso` | Lo que entra (+) |

Proporción aproximada en pantalla: 60 % papel y arena, 30 % verde-casa y no más de 5 % girasol. Si el girasol empieza a aparecer en más lugares, deja de significar "meta".

Por ahora solo hay tema claro. El tema oscuro queda pendiente: el encabezado verde ya funciona como bloque oscuro y no conviene invertirlo sin pensarlo.

## Tipografía

- **Fraunces** (display): montos, títulos y el logotipo. Siempre con `font-variant-numeric: tabular-nums` en los montos, para que las cifras queden alineadas en columna.
- **Instrument Sans** (texto): nombres, detalles, navegación y botones.
- Las dos se cargan desde Google Fonts.
- No se usa negrita en Fraunces salvo en el logotipo. La jerarquía la dan el tamaño y el color.
- Las etiquetas en mayúsculas (`etiqueta`) llevan 0.12em de espaciado y se usan para rótulos cortos, nunca para frases.

## Montos y monedas

- Pesos: `$ 186.400`, con espacio después del signo, punto de miles y sin decimales en las listas.
- Dólares: `US$ 650`, sin decimales desde 100; por debajo de 100 se muestran siempre los centavos: `US$ 40,00`, `US$ 12,99` (decidido por Martín el 3/10). Pesos uruguayos: `UY$ 12.000`. En los totales, lo de Uruguay se muestra en dólares.
- Lo que entra lleva `+` y va en `verde-ingreso`. Lo que sale no lleva signo: el contexto ya dice que es un gasto.
- Los montos estimados llevan `~` y van en `tinta-suave`: `~ $ 58.000`. Un monto es estimado mientras no tiene su monto real; el pago de una tarjeta deja de serlo cuando se carga el resumen real de ese mes (también la parte que se pasó al mes siguiente).
- En los resúmenes del celular se abrevia con coma decimal: `$ 3,25 M`, `$ 380 mil`.
- Los compromisos pagados pasan a `tinta-suave`: siguen visibles, pero dejan de pedir atención.

## Estados de un compromiso

Es la pieza más propia del sistema. Glifo de 16 px (12 px en la leyenda), trazo de 2 px:

| Glifo | Estado | Color |
| --- | --- | --- |
| Aro vacío | Pendiente | `verde-casa` |
| Aro medio lleno | Pagado en parte | `verde-casa` |
| Aro punteado | Postergado | `terracota` |
| Círculo lleno | Pagado | `verde-casa` |
| Aro con + | A cobrar (ingreso) | `verde-ingreso` |

Reglas:

- Al tocar el glifo (celular) o pasar el mouse (desktop) aparece el estado escrito con su detalle: "Parcial · pagaste $ 300.000 de $ 624.300".
- En desktop la leyenda está siempre al pie de la tabla. En el celular se muestra la primera vez y después solo al tocar.
- No se agregan etiquetas de color ("Pendiente", "Pagado") en las filas. Ese lugar es del monto.

## El camino del mes

El motivo gráfico de la marca: 31 puntos de izquierda a derecha sobre el verde, con una bandera girasol al final.

- Los días pasados son puntos llenos de 7 px en crema, y los que faltan son puntos de 6 px en crema al 32 %.
- Hoy es un punto girasol de 14 px con un halo.
- En desktop, debajo de cada día con un vencimiento hay una marca girasol de 2 × 8 px (en `salvia-2` si el día ya pasó), con rótulos en 1, hoy, 8, 15, 22 y 31.
- Va siempre dentro del encabezado verde, debajo del monto principal. No se usa como decoración en otras partes.

## Pantallas

**Celular (390 px)**

- Encabezado verde con el logotipo, los avatares, la etiqueta del mes, "Llegás al 31 con", el monto principal y el camino del mes.
- Tres tarjetas de resumen: Entra, Sale, En cuotas.
- La lista "Este mes" con filas en tarjetas de arena.
- Barra inferior con Mes, Proyección, el botón Cargar al centro, Bandeja y Más.

**Desktop**

- Barra lateral verde de 240 px: logotipo, botón Cargar, navegación principal, la sección "Lo que tenemos" (tarjetas, préstamos, propiedades, ingresos, gastos recurrentes, gastos puntuales; estos dos últimos agregados por Martín el 3/10), las cotizaciones y quién está conectado.
- Contenido de hasta 1120 px de ancho.
- Encabezado verde con el monto de 76 px, el resumen a la derecha y el camino con sus marcas de vencimiento.
- Abajo, la tabla de compromisos con filtros y una columna lateral: Esta semana, Por moneda, Próximos meses.

## Voz

| En vez de | Decimos |
| --- | --- |
| Saldo proyectado al cierre | Llegás al 31 con |
| Egresos / Ingresos | Sale / Entra |
| Postergado al 15/10 | Lo pasaste al 15 |
| Pagado el 01/10 | Listo el 1 |
| Vencimiento 05/10 | Vence el sábado 5 |
| Liquidez requerida (7 días) | Necesitás tener |

Tuteo rioplatense, frases cortas, fechas con el día de la semana cuando están cerca.

## Accesibilidad

- El texto tiene un contraste de al menos 4,5:1 sobre su fondo. `girasol` nunca va como texto sobre papel o arena.
- Los estados se distinguen por la forma (ver arriba) y además tienen texto accesible.
- Los blancos táctiles miden al menos 44 px. El botón Cargar mide 58 px.

## Pendiente

- Tema oscuro.
- Íconos para la barra lateral y la navegación (por ahora es solo texto).
- Pantalla de alta de compromisos y diseño de referencia de la Bandeja (hay una primera versión, E3, con las filas en tarjetas de arena, el filtro segmentado y un contador junto a «Bandeja» en la navegación).
- Proyección a 12 meses: hay una primera versión (E1) armada con los tokens y componentes de este manual (tabla con Entra, Sale, Queda, Queda en US$ y En cuotas); falta su diseño de referencia.
- Ícono de la app instalable: el 31 encerrado sobre verde.


## Diseños de referencia

Los diseños aprobados son los de la **versión D (Casa + Libreta)**, en el lienzo de diseño de Meta31:

- [Lienzo de diseño de Meta31](https://claude.ai/artifact/HgXQrwHe4A7CJok9iZ2fLt)
  - **Celular:** el diseño "D · Casa + Libreta" (390 × 844), en la primera fila, a la derecha.
  - **Desktop:** el diseño "D · Desktop — vista del mes" (1440 px), en la segunda fila, bajo el título "Versión D · desktop".
  - Las opciones A, B y C quedan en el lienzo como antecedente. La B está descartada.
- [Sistema de diseño Meta31](https://claude.ai/artifact/NjivKFKMQfwGKtmS4mVap5): la versión viva de este manual, con tokens y componentes.

Los dos links son privados: para abrirlos hay que tener acceso a la cuenta, o compartirlos desde el menú Compartir de cada uno.
