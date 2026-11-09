import { expect, test } from 'claude-code/testing'

import { barra, chispa, corto, numero, repartir } from '../hooks/register'

const PANEL = {
  plugin: 'contador-tokens',
  component: 'Pane',
  requestId: 'contador-tokens',
  props: {
    title: 'Tokens',
    isFocused: false,
    bodyColumns: 28,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const USO = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 50000, cache_creation_input_tokens: 2000 }

test('formatos', () => {
  expect(numero(1234)).toBe('1.234')
  expect(numero(1234567)).toBe('1,23 M')
  expect(corto(53500)).toBe('53,5 k')
  expect(barra(50, 10)).toBe('█████░░░░░')
  expect(repartir([1, 1, 2], 8)).toEqual([2, 2, 4])
  expect(repartir([0, 0], 5)).toEqual([0, 0])
  expect(repartir([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10)
  expect(chispa([0, 50, 100])).toBe('▁▄█')
})

async function preparar($: any, on: any) {
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer, usage: e.usage }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const fin = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' as const }
  await $.turn.complete({ ...fin, turnId: 't1', usage: { ...USO, model: 'claude-opus-5-5' } })
  await $.turn.complete({ ...fin, turnId: 't2', agentId: 'a1', usage: { ...USO, model: 'claude-haiku-5-5' } })
  await $.session.measure({
    context: { tokens: 100000, window: 200000, percent: 50 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    cost: { usd: 1.5 },
    changed: ['context', 'rateLimits', 'cost'],
  })
}

test('terminal: barras de colores, historial y límites', async ($, on) => {
  await preparar($, on)
  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  // ancho = 28 - 8 = 20 casillas
  expect((await ui.find({ type: 'Text', text: /50%/ }))?.text).toBe(`${'█'.repeat(10)}${'░'.repeat(10)} 50%`)
  expect((await ui.find({ type: 'Text', text: /de 200\.000 tokens/ }))?.text).toBe('100.000 de 200.000 tokens')
  expect((await ui.find({ type: 'Text', text: /^Sesión/ }))?.text).toBe('Sesión (1 turnos, 1 de subagentes)')
  expect((await ui.find({ type: 'Text', text: /Entrada:/ }))?.text).toBe('■ Entrada:       2.400')
  expect((await ui.find({ type: 'Text', text: /^Total:/ }))?.text).toBe('Total:           107.000')
  expect((await ui.find({ type: 'Text', text: /^Costo:/ }))?.text).toBe('Costo:           US$ 1.50')
  expect((await ui.find({ type: 'Text', text: /^máx/ }))?.text).toBe('máx 53,5 k · último 53,5 k')
  expect((await ui.find({ type: 'Text', text: /^5 horas/ }))?.text).toBe(`5 horas ${'█'.repeat(2)}${'░'.repeat(14)} 12%`)
  // Barra de composición: 20 casillas repartidas entre los cuatro tipos.
  const compo = await ui.find({ type: 'Text', text: /^█+$/ })
  expect(compo?.text.length).toBe(20)
  await ui.unmount()
})

test('escritorio, VS Code y móvil: gráficos SVG', async ($, on) => {
  await preparar($, on)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs).toHaveLength(3)
    expect(svgs[0].props.alt).toBe('Contexto 50%: 100.000 de 200.000 tokens. Sesión 107.000 tokens.')
    expect(String(svgs[0].props.source)).toContain('>50%</text>')
    expect(String(svgs[0].props.source)).toContain('US$ 1.50')
    expect(svgs[1].props.alt).toBe('Tokens por turno, últimos 1 turnos')
    expect(svgs[2].props.alt).toBe('5 horas 12%')
    expect((await ui.find({ type: 'Text', text: /^Sesión/ }))?.text).toBe('Sesión (1 turnos, 1 de subagentes)')
    await ui.unmount()
  }
})

test('reiniciar vacía totales e historial', async ($, on) => {
  await preparar($, on)
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  await ui.press({ key: 'reiniciar' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
  expect((await ui.find({ type: 'Text', text: /^Sesión/ }))?.text).toBe('Sesión (0 turnos)')
  await ui.unmount()
})

test('sin turnos todavía', async ($, on) => {
  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect((await ui.find({ type: 'Text', text: /Sin medir/ }))?.text).toBe(
      'Sin medir todavía (se mide al terminar el primer turno).',
    )
    await ui.unmount()
  }
})

const OPCIONES = {
  supabase_url: 'https://demo.supabase.co/',
  supabase_anon_key: 'anon-123',
  token_dispositivo: 'ctk_abc',
}

test('envía cada medición a Supabase', { options: OPCIONES }, async ($, on) => {
  const envios: { url: string; init: any }[] = []
  on('http.fetch', (_: any, e: any) => {
    envios.push(e)
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await preparar($, on)
  await new Promise(r => setTimeout(r, 20))
  expect(envios).toHaveLength(1)
  expect(envios[0].url).toBe('https://demo.supabase.co/rest/v1/rpc/reportar_uso')
  expect(envios[0].init.headers.apikey).toBe('anon-123')
  expect(envios[0].init.headers.Authorization).toBeUndefined()
  const cuerpo = JSON.parse(envios[0].init.body)
  expect(cuerpo.p_token).toBe('ctk_abc')
  expect(cuerpo.p_datos).toMatchObject({
    sesion: '0',
    proyecto: '/',
    contexto: 100000,
    ventana: 200000,
    porcentaje: 50,
    costoUsd: 1.5,
    modelo: 'claude-opus-5-5',
    totales: { entrada: 2400, salida: 600, turnos: 1, turnosSubagentes: 1 },
    limites: [{ tipo: 'five_hour', usado: 12 }],
  })
  expect(cuerpo.p_datos.historial).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Sincronizado \d\d:\d\d$/ }))).toBeDefined()
  await ui.unmount()
})

test('muestra el error de Supabase', { options: OPCIONES }, async ($, on) => {
  on('http.fetch', () => ({ value: { status: 400, ok: false, headers: {}, text: '{"message":"Token de dispositivo no válido"}' } }))
  await preparar($, on)
  await new Promise(r => setTimeout(r, 20))
  const ui = await $.ui.mount({ ...PANEL, surface: 'mobile' })
  expect((await ui.find({ type: 'Text', text: /^Sin sincronizar/ }))?.text).toBe(
    'Sin sincronizar: Token de dispositivo no válido',
  )
  await ui.unmount()
})

test('sin configurar no envía nada', async ($, on) => {
  let llamadas = 0
  on('http.fetch', () => {
    llamadas++
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await preparar($, on)
  await new Promise(r => setTimeout(r, 20))
  expect(llamadas).toBe(0)
  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /incroniz/ })).toBeUndefined()
  await ui.unmount()
})

test('vincular canjea el código y envía con ese token', { options: { supabase_url: 'https://demo.supabase.co', supabase_anon_key: 'anon-123' } }, async ($, on) => {
  const envios: { url: string; init: any }[] = []
  const guardado = new Map<string, unknown>()
  on('store.set', (_: any, e: any) => { guardado.set(e.key, e.value); return { value: undefined } })
  on('store.get', (_: any, e: any) => ({ value: guardado.get(e.key) }))
  on('http.fetch', (_: any, e: any) => {
    envios.push(e)
    const texto = e.url.endsWith('canjear_codigo_vinculo') ? '"ctk_nuevo"' : ''
    return { value: { status: 200, ok: true, headers: {}, text: texto } }
  })
  await preparar($, on)
  const r = await $.command.run({ command: 'tokens', args: 'vincular abcd-2345' })
  expect(r.text).toMatch(/Vinculado/)
  expect(JSON.parse(envios[0].init.body).p_codigo).toBe('abcd-2345')
  expect(guardado.get('token_dispositivo')).toBe('ctk_nuevo')
  await $.session.measure({ context: { tokens: 1, window: 200000, percent: 1 }, rateLimits: [], cost: { usd: 1 }, changed: ['cost'] })
  await new Promise(r => setTimeout(r, 20))
  const rep = envios.find(e => e.url.endsWith('reportar_uso'))
  expect(JSON.parse(rep!.init.body).p_token).toBe('ctk_nuevo')
})
