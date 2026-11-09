# Contador de tokens: mod para Claude Code

Panel con el conteo de tokens de tu sesión (contexto, totales por turno, costo y límites de uso) que además
se sincroniza con tu cuenta de la app **Contador de tokens** (Android y Windows).

## Instalar

En Claude Code:

```
/plugin install contador-tokens --marketplace Duman07/contador-tokens-mod
```

Reinicia Claude Code después de instalarlo.

## Vincular este equipo con tu cuenta

1. En la app, tarjeta **Vincular Claude Code → Generar código**.
2. En Claude Code de este equipo: `/tokens vincular CÓDIGO`.

El código vale 10 minutos y se usa una sola vez. Se hace una vez por equipo; la app suma el consumo de todos
tus equipos. `/tokens desvincular` lo quita de este equipo.

## Qué envía

Solo las cifras de uso de cada sesión (tokens, costo, modelo, nombre del proyecto y límites) con una llave de
dispositivo que solo sirve para reportar uso y que puedes revocar desde la app. No envía tu código, tus
conversaciones ni tus credenciales.

## Servidor propio

Por defecto usa el servidor de la app. Para usar el tuyo, en `/config` → contador-tokens pon la URL y la clave
pública de tu proyecto de Supabase.
