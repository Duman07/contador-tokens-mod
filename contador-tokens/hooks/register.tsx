import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Medida, Sesion, Sync, Totales, Turno } from '../types'

const PANEL = 'contador-tokens'
const TITULO = 'Tokens'
const MAX_HISTORIAL = 40

const VACIO: Totales = { entrada: 0, salida: 0, cacheLeida: 0, cacheEscrita: 0, turnos: 0, turnosSubagentes: 0 }

// Cambiar la etiqueta si cambian los campos: descarta lo que guardó una versión anterior.
const totales = atom({ plugin: 'contador-tokens', key: 'totales' } as const, VACIO, { shape: 'totales-1' })
const medida = atom({ plugin: 'contador-tokens', key: 'medida' } as const, { ventana: 0, limites: [] } as Medida, {
  shape: 'medida-1',
})
const historial = atom({ plugin: 'contador-tokens', key: 'historial' } as const, [] as Turno[], {
  shape: 'historial-1',
})

const sesion = atom({ plugin: 'contador-tokens', key: 'sesion' } as const, { id: '', proyecto: '' } as Sesion, {
  shape: 'sesion-1',
})
const sync = atom({ plugin: 'contador-tokens', key: 'sync' } as const, { estado: 'pendiente' } as Sync, {
  shape: 'sync-1',
})

const NOMBRES_LIMITE: Record<string, string> = { five_hour: '5 horas', seven_day: '7 días', spend_limit: 'Gasto' }

// Una paleta para todas las superficies: verde / amarillo / rojo para lo que se llena,
// y un color por tipo de token.
const COLOR = {
  ok: '#3fb950',
  medio: '#d29922',
  alto: '#f85149',
  entrada: '#58a6ff',
  salida: '#bc8cff',
  cacheLeida: '#3fb950',
  cacheEscrita: '#d29922',
  vacio: '#30363d',
  tenue: '#8b949e',
}

const PARTES = [
  { campo: 'entrada', nombre: 'Entrada', color: COLOR.entrada },
  { campo: 'salida', nombre: 'Salida', color: COLOR.salida },
  { campo: 'cacheLeida', nombre: 'Caché leída', color: COLOR.cacheLeida },
  { campo: 'cacheEscrita', nombre: 'Caché escrita', color: COLOR.cacheEscrita },
] as const

/** 1234 → «1.234»; 1234567 → «1,23 M». */
export function numero(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace('.', ',')} M`
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** 1234 → «1,2 k»: para etiquetas cortas de los gráficos. */
export function corto(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.', ',')} k`
  return String(Math.round(n))
}

/** Barra de casillas para un porcentaje de 0 a 100. */
export function barra(porcentaje: number, ancho = 20): string {
  const llenas = Math.max(0, Math.min(ancho, Math.round((porcentaje / 100) * ancho)))
  return '█'.repeat(llenas) + '░'.repeat(ancho - llenas)
}

/** Verde hasta 60 %, amarillo hasta 85 %, rojo después. */
export function colorDe(porcentaje: number): string {
  return porcentaje >= 85 ? COLOR.alto : porcentaje >= 60 ? COLOR.medio : COLOR.ok
}

/** Reparte `ancho` casillas en proporción a los valores (resto mayor), sin perder ninguna. */
export function repartir(valores: number[], ancho: number): number[] {
  const suma = valores.reduce((a, b) => a + b, 0)
  if (suma <= 0) return valores.map(() => 0)
  const exactas = valores.map(v => (v / suma) * ancho)
  const casillas = exactas.map(Math.floor)
  let faltan = ancho - casillas.reduce((a, b) => a + b, 0)
  const orden = exactas.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of orden) {
    if (faltan-- <= 0) break
    casillas[i]++
  }
  return casillas
}

const PICOS = '▁▂▃▄▅▆▇█'

/** Una línea de chispa: un carácter por valor, alto según el máximo. */
export function chispa(valores: number[]): string {
  const max = Math.max(1, ...valores)
  return valores.map(v => PICOS[Math.min(7, Math.floor((v / max) * 7.999))]).join('')
}

function totalTurno(t: Turno) {
  return t.entrada + t.salida + t.cache
}

function hora(iso?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- Gráficos SVG (escritorio, VS Code y móvil) ----------

const FUENTE = 'font-family="system-ui,-apple-system,Segoe UI,sans-serif"'

function svgContexto(m: Medida, t: Totales): string {
  const pct = m.porcentaje ?? 0
  const r = 46
  const c = 2 * Math.PI * r
  const lleno = (Math.min(100, pct) / 100) * c
  const total = t.entrada + t.salida + t.cacheLeida + t.cacheEscrita
  const anchos = repartir(
    PARTES.map(p => t[p.campo]),
    300,
  )
  let x = 10
  const segmentos = PARTES.map((p, i) => {
    const s = `<rect x="${x}" y="134" width="${anchos[i]}" height="14" fill="${p.color}"/>`
    x += anchos[i]
    return s
  }).join('')
  const leyenda = PARTES.map((p, i) => {
    const lx = 10 + (i % 2) * 155
    const ly = 172 + Math.floor(i / 2) * 20
    return `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="${p.color}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="${COLOR.tenue}">${p.nombre} ${corto(t[p.campo])}</text>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210" viewBox="0 0 320 210" ${FUENTE}>
<circle cx="66" cy="62" r="${r}" fill="none" stroke="${COLOR.vacio}" stroke-width="12"/>
<circle cx="66" cy="62" r="${r}" fill="none" stroke="${colorDe(pct)}" stroke-width="12" stroke-linecap="round"
  stroke-dasharray="${lleno.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 66 62)"/>
<text x="66" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="${colorDe(pct)}">${pct}%</text>
<text x="66" y="84" text-anchor="middle" font-size="11" fill="${COLOR.tenue}">contexto</text>
<text x="132" y="44" font-size="12" fill="${COLOR.tenue}">Ventana</text>
<text x="132" y="62" font-size="15" font-weight="600" fill="${colorDe(pct)}">${corto(m.contexto ?? 0)} / ${corto(m.ventana)}</text>
<text x="132" y="86" font-size="12" fill="${COLOR.tenue}">Sesión: ${corto(total)} tokens</text>
${m.costoUsd !== undefined ? `<text x="132" y="104" font-size="12" fill="${COLOR.tenue}">Costo: US$ ${m.costoUsd.toFixed(2)}</text>` : ''}
<rect x="10" y="134" width="300" height="14" rx="7" fill="${COLOR.vacio}"/>
<clipPath id="r"><rect x="10" y="134" width="300" height="14" rx="7"/></clipPath>
<g clip-path="url(#r)">${segmentos}</g>
${leyenda}
</svg>`
}

function svgHistorial(lista: Turno[]): string {
  const alto = 80
  const n = Math.max(lista.length, 1)
  const paso = 300 / n
  const ancho = Math.max(2, paso - 2)
  const max = Math.max(1, ...lista.map(totalTurno))
  const barras = lista
    .map((t, i) => {
      const x = 10 + i * paso
      const esc = alto / max
      const hc = t.cache * esc
      const he = t.entrada * esc
      const hs = t.salida * esc
      const base = 10 + alto
      return (
        `<rect x="${x.toFixed(1)}" y="${(base - hc).toFixed(1)}" width="${ancho.toFixed(1)}" height="${hc.toFixed(1)}" fill="${COLOR.cacheLeida}" opacity="0.55"/>` +
        `<rect x="${x.toFixed(1)}" y="${(base - hc - he).toFixed(1)}" width="${ancho.toFixed(1)}" height="${he.toFixed(1)}" fill="${COLOR.entrada}"/>` +
        `<rect x="${x.toFixed(1)}" y="${(base - hc - he - hs).toFixed(1)}" width="${ancho.toFixed(1)}" height="${hs.toFixed(1)}" fill="${COLOR.salida}"/>`
      )
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="110" viewBox="0 0 320 110" ${FUENTE}>
<line x1="10" y1="90.5" x2="310" y2="90.5" stroke="${COLOR.vacio}"/>
${barras}
<text x="10" y="106" font-size="11" fill="${COLOR.tenue}">${lista.length} turnos · máx ${corto(max)}</text>
<text x="310" y="106" text-anchor="end" font-size="11" fill="${COLOR.tenue}">último ${corto(lista.length ? totalTurno(lista[lista.length - 1]) : 0)}</text>
</svg>`
}

function svgLimites(limites: Medida['limites']): string {
  const filas = limites
    .map((l, i) => {
      const y = 10 + i * 34
      const w = (Math.min(100, l.usado) / 100) * 300
      const reinicia = hora(l.reinicia)
      return `<text x="10" y="${y + 10}" font-size="12" fill="${COLOR.tenue}">${NOMBRES_LIMITE[l.tipo] ?? l.tipo}${reinicia ? ` · reinicia ${reinicia}` : ''}</text>
<text x="310" y="${y + 10}" text-anchor="end" font-size="12" font-weight="600" fill="${colorDe(l.usado)}">${l.usado}%</text>
<rect x="10" y="${y + 16}" width="300" height="8" rx="4" fill="${COLOR.vacio}"/>
<rect x="10" y="${y + 16}" width="${w.toFixed(1)}" height="8" rx="4" fill="${colorDe(l.usado)}"/>`
    })
    .join('')
  const alto = 10 + limites.length * 34
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="${alto}" viewBox="0 0 320 ${alto}" ${FUENTE}>${filas}</svg>`
}

// ---------- Datos ----------

function aMedida(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost?: SessionCost): Medida {
  return {
    contexto: context.tokens,
    ventana: context.window,
    porcentaje: context.percent,
    costoUsd: cost?.usd,
    limites: rateLimits.map(l => ({ tipo: l.kind, usado: l.percentUsed, reinicia: l.resetsAt })),
  }
}

function abrir($: EngineInterface) {
  return $.ui.open({ id: PANEL, title: TITULO })
}

// ---------- Sincronización con Supabase ----------

type Config = { url: string; clave: string; token: string }

/** Servidor compartido de la app: así nadie tiene que montar su propio Supabase.
 *  Quien publique la app pone aquí la URL y la clave publishable (son públicas). */
const SERVIDOR = {
  url: 'https://yfkranlvpwonegcdcupc.supabase.co',
  clave: 'sb_publishable_VcKurmw2aJbBxxl7GLsUaw_3gjSY4P0',
}

type Servidor = { url: string; clave: string }

function leerServidor(options: Record<string, unknown>): Servidor | undefined {
  const url = String(options.supabase_url ?? '').trim().replace(/\/+$/, '') || SERVIDOR.url
  const clave = String(options.supabase_anon_key ?? '').trim() || SERVIDOR.clave
  return url && clave ? { url, clave } : undefined
}

/** El token viene de `/tokens vincular CÓDIGO` (guardado entre sesiones) o, si se prefiere, de /config. */
async function leerConfig($: EngineInterface, options: Record<string, unknown>): Promise<Config | undefined> {
  const servidor = leerServidor(options)
  if (!servidor) return undefined
  // Si el almacén falla, simplemente no hay token: nunca debe frenar a Claude Code.
  const guardado = await $.store.get('token_dispositivo').catch(() => undefined)
  const token = String(options.token_dispositivo ?? '').trim() || String(guardado ?? '')
  return token ? { ...servidor, token } : undefined
}

/** Canjea el código que muestra la app por un token de dispositivo y lo guarda. */
async function vincular($: EngineInterface, options: Record<string, unknown>, codigo: string): Promise<string> {
  const servidor = leerServidor(options)
  if (!servidor) return 'Este mod no tiene servidor configurado: pon la URL y la clave en /config → contador-tokens.'
  if (!codigo.trim()) return 'Uso: /tokens vincular CÓDIGO (el código lo muestra la app, en «Vincular Claude Code»).'
  try {
    const r = await $.http.fetch(`${servidor.url}/rest/v1/rpc/canjear_codigo_vinculo`, {
      method: 'POST',
      headers: { apikey: servidor.clave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_codigo: codigo, p_nombre: `Claude Code (${new Date().toISOString().slice(0, 10)})` }),
    })
    if (!r.ok) {
      let mensaje = `HTTP ${r.status}`
      try {
        mensaje = JSON.parse(r.text).message ?? mensaje
      } catch {}
      return `No se pudo vincular: ${mensaje}`
    }
    const token = JSON.parse(r.text)
    if (typeof token !== 'string' || !token.startsWith('ctk_')) return 'No se pudo vincular: respuesta inesperada.'
    await $.store.set('token_dispositivo', token)
    return 'Vinculado. Tus próximos turnos se verán en la app.'
  } catch (err) {
    return `No se pudo vincular: ${String(err).slice(0, 120)}`
  }
}

/** Tokens de las peticiones del turno que sigue en curso: aún no están en `totales`. */
type Parcial = { entrada: number; salida: number; cacheLeida: number; cacheEscrita: number }
const SIN_PARCIAL: Parcial = { entrada: 0, salida: 0, cacheLeida: 0, cacheEscrita: 0 }

/** Lo que se manda a reportar_uso(): la foto actual de la sesión. */
export function paquete(s: Sesion, t: Totales, m: Medida, hist: Turno[], enCurso: Parcial = SIN_PARCIAL) {
  const { ultimo, ...acumulado } = t
  const suma = {
    ...acumulado,
    entrada: acumulado.entrada + enCurso.entrada,
    salida: acumulado.salida + enCurso.salida,
    cacheLeida: acumulado.cacheLeida + enCurso.cacheLeida,
    cacheEscrita: acumulado.cacheEscrita + enCurso.cacheEscrita,
  }
  return {
    sesion: s.id,
    proyecto: s.proyecto,
    contexto: m.contexto ?? null,
    ventana: m.ventana,
    porcentaje: m.porcentaje ?? null,
    costoUsd: m.costoUsd ?? null,
    modelo: ultimo?.modelo ?? null,
    totales: suma,
    limites: m.limites,
    historial: hist.slice(-20),
  }
}

// Estado del turno en curso. Vive en el módulo: si el mod se recarga, se pierde solo
// lo que va del turno, y `turn.complete` lo cuenta igual al terminar.
let enCurso: Parcial = SIN_PARCIAL
let ultimoEnvio = 0
/** Durante una respuesta larga, como mucho un envío cada tanto. */
const ENVIO_EN_CURSO_MS = 30_000

async function sincronizar($: EngineInterface, options: Record<string, unknown>) {
  const config = await leerConfig($, options)
  if (!config) return
  const s = await read($, sesion)
  if (!s.id) return
  ultimoEnvio = Date.now()
  const cuerpo = paquete(s, await read($, totales), await read($, medida), await read($, historial), enCurso)
  try {
    const r = await $.http.fetch(`${config.url}/rest/v1/rpc/reportar_uso`, {
      method: 'POST',
      // Solo `apikey`: sirve con la clave nueva (sb_publishable_…) y con la anon antigua (eyJ…).
      headers: {
        apikey: config.clave,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: config.token, p_datos: cuerpo }),
    })
    if (r.ok) {
      await update($, sync, () => ({ estado: 'ok', cuando: Date.now() }))
    } else {
      let mensaje = `HTTP ${r.status}`
      try {
        mensaje = JSON.parse(r.text).message ?? mensaje
      } catch {}
      await update($, sync, () => ({ estado: 'error', mensaje, cuando: Date.now() }))
    }
  } catch (err) {
    await update($, sync, () => ({ estado: 'error', mensaje: String(err).slice(0, 120), cuando: Date.now() }))
  }
}

function textoSync(s: Sync, activa: boolean): string | undefined {
  if (!activa) return undefined
  if (s.estado === 'ok' && s.cuando) {
    const d = new Date(s.cuando)
    return `Sincronizado ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (s.estado === 'error') return `Sin sincronizar: ${s.mensaje ?? 'error'}`
  return 'Sincronización: esperando el primer turno'
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const res = await next(e)
    await $.command.register({ name: 'tokens', description: 'Panel de tokens. «vincular CÓDIGO» conecta con tu cuenta de la app' })
    const uso = await $.session.usage()
    await update($, medida, () => aMedida(uso.context, uso.rateLimits, uso.cost))
    // startedAt no cambia al recargar el mod: la misma sesión sigue en la misma fila.
    const proyecto = e.cwd.split(/[\\/]/).filter(Boolean).pop() ?? e.cwd
    await update($, sesion, s => (s.id ? s : { id: `${uso.startedAt}`, proyecto }))
    void abrir($)
    return res
  })

  on('command.run', { command: 'tokens' }, async ($, e) => {
    const [accion = '', ...resto] = e.args.trim().split(/\s+/)
    if (accion === 'vincular') return { text: await vincular($, options, resto.join('')) }
    if (accion === 'desvincular') {
      await $.store.delete('token_dispositivo')
      return { text: 'Desvinculado de este equipo. Quita también el dispositivo en la app si quieres revocar el token.' }
    }
    await abrir($)
    return { text: 'Panel de tokens abierto.' }
  })

  // Después de cada turno (y cuando se mueve un límite) el motor manda las cifras nuevas.
  on('session.measure', async ($, e, next) => {
    await update($, medida, () => aMedida(e.context, e.rateLimits, e.cost))
    const res = await next(e)
    // Sin esperar: la red no frena a Claude Code.
    void sincronizar($, options)
    return res
  })

  // Mientras Claude trabaja (respuestas largas con muchas herramientas), cada petición al
  // modelo suma a `enCurso` y, cada 30 s como mucho, se manda la foto a Supabase.
  // Sin esto, el teléfono solo se enteraba al terminar la respuesta entera.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId === undefined && r.usage) {
      enCurso = {
        entrada: enCurso.entrada + r.usage.input_tokens,
        salida: enCurso.salida + r.usage.output_tokens,
        cacheLeida: enCurso.cacheLeida + r.usage.cache_read_input_tokens,
        cacheEscrita: enCurso.cacheEscrita + r.usage.cache_creation_input_tokens,
      }
    }
    if (Date.now() - ultimoEnvio >= ENVIO_EN_CURSO_MS && (await leerConfig($, options))) {
      ultimoEnvio = Date.now()
      const uso = await $.session.usage()
      await update($, medida, () => aMedida(uso.context, uso.rateLimits, uso.cost))
      void sincronizar($, options)
    }
    return r
  })

  // Tokens de cada turno, sumados: los del hilo principal y los de los subagentes.
  on('turn.complete', async ($, e, next) => {
    const uso = e.usage
    // El turno principal terminó: su suma completa entra en `totales`.
    if (!e.agentId) enCurso = SIN_PARCIAL
    if (uso) {
      await update($, totales, t => ({
        entrada: t.entrada + uso.input_tokens,
        salida: t.salida + uso.output_tokens,
        cacheLeida: t.cacheLeida + uso.cache_read_input_tokens,
        cacheEscrita: t.cacheEscrita + uso.cache_creation_input_tokens,
        turnos: t.turnos + (e.agentId ? 0 : 1),
        turnosSubagentes: t.turnosSubagentes + (e.agentId ? 1 : 0),
        ultimo: e.agentId
          ? t.ultimo
          : {
              entrada: uso.input_tokens,
              salida: uso.output_tokens,
              cacheLeida: uso.cache_read_input_tokens,
              cacheEscrita: uso.cache_creation_input_tokens,
              modelo: uso.model,
            },
      }))
      if (!e.agentId) {
        const turno: Turno = {
          entrada: uso.input_tokens,
          salida: uso.output_tokens,
          cache: uso.cache_read_input_tokens + uso.cache_creation_input_tokens,
        }
        await update($, historial, previo => [...previo, turno].slice(-MAX_HISTORIAL))
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const t = await read($, totales)
    const m = await read($, medida)
    const hist = await read($, historial)
    const lineaSync = textoSync(await read($, sync), (await leerConfig($, options)) !== undefined)
    const total = t.entrada + t.salida + t.cacheLeida + t.cacheEscrita
    const pct = m.porcentaje ?? 0
    const reiniciar = () => update($, totales, () => VACIO).then(() => update($, historial, () => []))
    const tituloSesion = `Sesión (${t.turnos} turnos${t.turnosSubagentes ? `, ${t.turnosSubagentes} de subagentes` : ''})`

    // Escritorio, VS Code y móvil: gráficos vectoriales.
    if (e.surface !== 'terminal') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          {m.contexto === undefined ? (
            <Text dimColor>Sin medir todavía (se mide al terminar el primer turno).</Text>
          ) : (
            <Svg
              source={svgContexto(m, t)}
              alt={`Contexto ${pct}%: ${numero(m.contexto)} de ${numero(m.ventana)} tokens. Sesión ${numero(total)} tokens.`}
            />
          )}
          <Text weight="semibold">{tituloSesion}</Text>
          {hist.length > 0 && (
            <Svg source={svgHistorial(hist)} alt={`Tokens por turno, últimos ${hist.length} turnos`} />
          )}
          {t.ultimo && (
            <Text size="footnote" dimColor>
              Último turno ({t.ultimo.modelo}): entrada {numero(t.ultimo.entrada)} · salida {numero(t.ultimo.salida)} ·
              caché {numero(t.ultimo.cacheLeida + t.ultimo.cacheEscrita)}
            </Text>
          )}
          {m.limites.length > 0 && <Text weight="semibold">Límites de uso</Text>}
          {m.limites.length > 0 && (
            <Svg
              source={svgLimites(m.limites)}
              alt={m.limites.map(l => `${NOMBRES_LIMITE[l.tipo] ?? l.tipo} ${l.usado}%`).join(', ')}
            />
          )}
          {lineaSync && (
            <Text size="caption" color={lineaSync.startsWith('Sin') ? COLOR.alto : COLOR.tenue}>
              {lineaSync}
            </Text>
          )}
          <Button key="reiniciar" label="Reiniciar totales" onPress={reiniciar} />
        </Box>
      )
    }

    // Terminal: el mismo estilo de bloques, con color.
    const { Box, Text, Button } = $.ui.resolve(e)
    const ancho = Math.max(10, Math.min(40, (e.props.bodyColumns ?? 40) - 8))
    const casillas = repartir(
      PARTES.map(p => t[p.campo]),
      ancho,
    )
    const chispas = hist.slice(-ancho)

    return (
      <Box flexDirection="column">
        <Text bold>Contexto</Text>
        {m.contexto === undefined ? (
          <Text dimColor>Sin medir todavía (se mide al terminar el primer turno).</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={colorDe(pct)}>
              {barra(pct, ancho)} {pct}%
            </Text>
            <Text>
              {numero(m.contexto)} de {numero(m.ventana)} tokens
            </Text>
          </Box>
        )}

        <Text> </Text>
        <Text bold>{tituloSesion}</Text>
        {total > 0 && (
          <Text>
            {PARTES.map((p, i) => (
              <Text color={p.color}>{'█'.repeat(casillas[i])}</Text>
            ))}
          </Text>
        )}
        {PARTES.map(p => (
          <Text>
            <Text color={p.color}>■ </Text>
            {(p.nombre + ':').padEnd(15)}
            {numero(t[p.campo])}
          </Text>
        ))}
        <Text bold>{'Total:'.padEnd(17)}{numero(total)}</Text>
        {m.costoUsd !== undefined && <Text>{'Costo:'.padEnd(17)}US$ {m.costoUsd.toFixed(2)}</Text>}

        {chispas.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Por turno</Text>
            <Text color={COLOR.entrada}>{chispa(chispas.map(totalTurno))}</Text>
            <Text dimColor>
              máx {corto(Math.max(...chispas.map(totalTurno)))} · último {corto(totalTurno(chispas[chispas.length - 1]))}
            </Text>
          </Box>
        )}

        {t.ultimo && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Último turno</Text>
            <Text dimColor>{t.ultimo.modelo}</Text>
            <Text>
              Entrada {numero(t.ultimo.entrada)} · Salida {numero(t.ultimo.salida)}
            </Text>
            <Text>
              Caché leída {numero(t.ultimo.cacheLeida)} · escrita {numero(t.ultimo.cacheEscrita)}
            </Text>
          </Box>
        )}

        {m.limites.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Límites de uso</Text>
            {m.limites.map(l => (
              <Text>
                {(NOMBRES_LIMITE[l.tipo] ?? l.tipo).padEnd(8)}
                <Text color={colorDe(l.usado)}>{barra(l.usado, 16)}</Text> {l.usado}%
                {hora(l.reinicia) ? <Text dimColor> · {hora(l.reinicia)}</Text> : ''}
              </Text>
            ))}
          </Box>
        )}

        <Text> </Text>
        {lineaSync && <Text color={lineaSync.startsWith('Sin') ? 'red' : undefined} dimColor={!lineaSync.startsWith('Sin')}>{lineaSync}</Text>}
        <Button key="reiniciar" label="Reiniciar totales" onPress={reiniciar} />
      </Box>
    )
  })
}
