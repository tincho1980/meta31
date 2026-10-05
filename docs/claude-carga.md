# Carga de comprobantes con Claude (E3)

Cómo usa cada uno su Claude para cargar comprobantes en Meta31 (RF-35). Conexión: `docs/setup.md` paso 12.

## Carpetas

En una carpeta compartida (por ejemplo, en OneDrive):

```
Meta31/
  entrada/      acá se dejan los PDF o fotos de los comprobantes
  procesados/   acá los mueve Claude después de cargarlos
```

El archivo no se guarda en Meta31: queda en `procesados/`. Meta31 guarda su nombre y su huella (SHA-256), y así reconoce si el mismo archivo se carga dos veces.

## Qué carga Claude

| Comprobante | Herramienta |
| --- | --- |
| Resumen de tarjeta (totales y cada movimiento) | `load_card_statement` |
| Factura de servicio (luz, gas, agua, celular) | `record_utility_bill` |
| Impuesto (ARBA, municipal) | `record_tax` |
| Expensas | `record_condo_fee` |
| Aviso o débito de cuota de préstamo (importe total) | `record_loan_installment` |
| Comprobante de pago de una factura o cuota | `register_payment` |
| Comprobante de pago de un resumen de tarjeta | `register_card_payment` |
| Algo que no reconoce (tarjeta nueva, servicio no cargado) | `report_unrecognized` |

Nada de esto cambia el mes: cada comprobante queda **A revisar** en la Bandeja de la app, donde lo confirmás, lo corregís o lo descartás.

## Instrucciones para Claude

Para pegar en las instrucciones de un proyecto de Claude (o al empezar la conversación), con acceso a la carpeta:

> Cargá en Meta31 los comprobantes de la carpeta `Meta31/entrada`. Para cada archivo:
> 1. Calculá su SHA-256 y fijate con `find_document` si ya se cargó. Si ya está, movelo a `procesados` y seguí.
> 2. Leelo e identificá de qué es con las herramientas `list_*` (tarjeta, gasto recurrente, préstamo, propiedad). Usá siempre los ids que te devuelven; nunca inventes uno.
> 3. Llamá a la herramienta de carga que corresponde. El mes (`period`) es el del vencimiento, con día 1. Los montos van con punto decimal y en su moneda, sin convertir. En un resumen de tarjeta cargá todos los movimientos que puedas; las cuotas "n de N" apuntan a la compra en cuotas de esa tarjeta (`list_card_items`).
> 4. Si no reconocés la entidad o no podés leer el archivo, usá `report_unrecognized` con el motivo. No adivines.
> 5. Si la herramienta rechaza el comprobante, seguí lo que dice el `hint`.
> 6. Mové el archivo a `Meta31/procesados`.
> Al terminar, decime qué cargaste y qué quedó sin reconocer, para que lo revise en la Bandeja.

## Qué revisar en la Bandeja

- Que la tarjeta, el servicio o el préstamo sean los correctos.
- Mes y monto. En un resumen, los totales; los movimientos mal leídos se pueden sacar antes de confirmar y corregir después desde el resumen.
- Los "No reconocido": **Completar** elige la operación y los datos a mano. Si falta la entidad (por ejemplo, una tarjeta nueva), cargala primero desde Cargar.
