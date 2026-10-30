/**
 * Host half of `dsh-websearch-toggle`.
 *
 * Keeps one boolean per Session in `$DSH_HOME/websearch-toggle.json` and, while a
 * Session is switched off, hides the `web_search` tool from that Session's agents by
 * applying `ctx.tools.restrict({ deny })` to each agent context as it is created.
 * The browser half reads and writes the same state through the two routes below.
 *
 * State defaults to enabled: a Session without a record keeps the shipped tool set.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis function-plugin name. */
export const name = 'websearch-toggle'

/** The services this plugin needs; `connection` is read opportunistically. */
export const inject = ['webServer', 'agents', 'tools']

/** Tools hidden while a Session is switched off. */
const DEFAULT_DENY = ['web_search']

/** Exact route serving the per-Session state. */
const STATE_PATH = '/websearch-toggle/state'

/** Request bodies are two short fields; anything larger is hostile. */
const MAX_BODY_BYTES = 4096

/** Absolute state file path, honouring `DSH_HOME`. */
function stateFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'websearch-toggle.json')
}

/** One JSON response. */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** Read a bounded request body as text. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Load the state document; any read or parse failure falls back to empty state. */
function loadState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
      return { version: 1, sessions: { ...parsed.sessions } }
    }
  } catch {}
  return { version: 1, sessions: {} }
}

/**
 * Apply this plugin's host-side behaviour.
 * @param ctx - the host plugin context.
 */
export function apply(ctx, config = {}) {
  const denyTools = Array.isArray(config?.denyTools) && config.denyTools.length > 0
    ? config.denyTools.filter((name) => typeof name === 'string' && name !== '')
    : DEFAULT_DENY
  const file = stateFile()
  let state = loadState(file)
  /** Live restriction disposers, one per agent id. */
  const disposers = new Map()

  /** Persist the state document; a failed write is reported but never thrown. */
  const save = () => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(state, null, 2) + '\n')
    } catch (error) {
      ctx.logger?.warn?.(`websearch-toggle: cannot write ${file}: ${String(error)}`)
    }
  }

  /** The parent Session id a child agent inherits from, when the Session exposes one. */
  const parentOf = (agent) => {
    const meta = agent?.session?.meta
    for (const candidate of [meta?.parentSessionId, meta?.parent, agent?.session?.parentId]) {
      if (typeof candidate === 'string' && candidate !== '') return candidate
    }
    return undefined
  }

  /** The effective value for one Session: own record, then the parent's, then enabled. */
  const enabledFor = (sessionId) => {
    const own = state.sessions[sessionId]
    if (typeof own === 'boolean') return own
    return true
  }

  /** The effective value for an agent, following one parent hop. */
  const enabledForAgent = (agent) => {
    const own = state.sessions[agent?.session?.id]
    if (typeof own === 'boolean') return own
    const parent = parentOf(agent)
    if (parent !== undefined) {
      const inherited = state.sessions[parent]
      if (typeof inherited === 'boolean') return inherited
    }
    return true
  }

  /**
   * Bring one agent's tool set in line with its Session's current value: install the
   * deny mask when off, lift the previous one when on.
   * @param agent - the live agent, keyed by its Session id.
   */
  const sync = (agent) => {
    const id = agent?.id ?? agent?.session?.id
    if (typeof id !== 'string' || id === '') return
    const current = disposers.get(id)
    if (enabledForAgent(agent)) {
      if (current !== undefined) {
        try {
          current()
        } catch {}
        disposers.delete(id)
      }
      return
    }
    if (current !== undefined) return
    try {
      const dispose = agent.ctx.tools.restrict({ deny: denyTools })
      disposers.set(id, dispose)
    } catch (error) {
      ctx.logger?.warn?.(`websearch-toggle: cannot restrict ${denyTools.join(',')} for ${id}: ${String(error)}`)
    }
  }

  ctx.effect(() => {
    const off = ctx.on('agent/created', ({ agent }) => sync(agent))
    return () => {
      off?.()
      for (const dispose of disposers.values()) {
        try {
          dispose()
        } catch {}
      }
      disposers.clear()
    }
  }, 'websearch-toggle: agent lifecycle')

  ctx.effect(() => {
    const off = ctx.on('agent/disposed', ({ agent }) => {
      const id = agent?.id ?? agent?.session?.id
      if (typeof id !== 'string') return
      disposers.delete(id)
    })
    return () => off?.()
  }, 'websearch-toggle: agent disposal')

  for (const agent of ctx.agents.list?.() ?? []) sync(agent)

  ctx.effect(() => ctx.tools.guard((exec) => {
    if (typeof exec?.name !== 'string' || !denyTools.includes(exec.name)) return undefined
    if (enabledForAgent(exec.agent)) return undefined
    return `\`${exec.name}\` is disabled for this session`
  }), 'websearch-toggle: call guard')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: async (req, res) => {
      const connection = ctx.get?.('connection')
      const rejection = connection?.requestRejection?.(req)
      if (typeof rejection === 'number') {
        res.statusCode = rejection
        res.end()
        return
      }
      const url = new URL(String(req.url), 'http://localhost')
      if (req.method === 'GET') {
        const session = url.searchParams.get('session') ?? ''
        if (session === '') {
          sendJson(res, 400, { error: 'session is required' })
          return
        }
        sendJson(res, 200, { enabled: enabledFor(session) })
        return
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'GET, POST')
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: 'invalid json body' })
        return
      }
      const session = body?.session
      const enabled = body?.enabled
      if (typeof session !== 'string' || session === '' || typeof enabled !== 'boolean') {
        sendJson(res, 400, { error: 'session and boolean enabled are required' })
        return
      }
      state.sessions[session] = enabled
      save()
      const agent = ctx.agents.get(session)
      if (agent !== undefined) sync(agent)
      sendJson(res, 200, { enabled })
    },
  }), `websearch-toggle: ${STATE_PATH}`)
}
