/** Tokens sumados de los turnos de la sesión (principal y subagentes). */
export type Totales = {
  entrada: number
  salida: number
  cacheLeida: number
  cacheEscrita: number
  turnos: number
  turnosSubagentes: number
  ultimo?: { entrada: number; salida: number; cacheLeida: number; cacheEscrita: number; modelo: string }
}

/** Lo último que midió el motor: contexto, costo y límites de uso. */
export type Medida = {
  contexto?: number
  ventana: number
  porcentaje?: number
  costoUsd?: number
  limites: { tipo: string; usado: number; reinicia?: string }[]
}

/** Un turno del hilo principal, para el gráfico de historial. */
export type Turno = { entrada: number; salida: number; cache: number }

/** Qué sesión es esta, para su fila en Supabase. */
export type Sesion = { id: string; proyecto: string }

/** Cómo fue el último envío a Supabase. */
export type Sync = { estado: 'pendiente' | 'ok' | 'error'; mensaje?: string; cuando?: number }

declare module 'claude-code' {
  interface PluginState {
    'contador-tokens': {
      totales: Shaped<Totales>
      medida: Shaped<Medida>
      historial: Shaped<Turno[]>
      sesion: Shaped<Sesion>
      sync: Shaped<Sync>
    }
  }
}
