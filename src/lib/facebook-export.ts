import type { ExportResult } from '@/shared/export-contract'

type CapturePhase = 'idle' | 'initial' | 'bottom' | 'top' | 'top-settle'

type ExportState = {
  running: boolean
  aborted: boolean
  phase: CapturePhase
  batch: number
  harvest: null | {
    observer: MutationObserver
  }
}

type ParsedLabel = {
  time: string
  sender: string
  body: string
}

type ParsedRecord = ParsedLabel & {
  seq: number
  phase: CapturePhase
  batch: number
}

type UnparsedRecord = {
  seq: number
  phase: CapturePhase
  batch: number
  raw: string
  unparsed: true
}

type CapturedRecord = ParsedRecord | UnparsedRecord

type HarvestStore = {
  messages: Map<string, CapturedRecord>
  order: string[]
  startedAt: number
  conversation: string | null
  lastLoggedCount: number
}

type HarvestSession = {
  observer: MutationObserver
  store: HarvestStore
}

type ScrollOptions = {
  settlePause?: number
  settleChecks?: number
  maxSteps?: number
  wiggles?: number
}

type TopScrollOptions = {
  stepPause?: number
  settle?: number
  maxSteps?: number
}

type ExportOptions = {
  bottomOptions?: ScrollOptions
  topOptions?: TopScrollOptions
  calibrationTimeoutMs?: number
}

declare global {
  interface Window {
    __fbScrape?: ExportState
  }
}

const LABEL_RE = /^At (.+?), ([^:]+): ([\s\S]+)$/
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_INDEX = Object.fromEntries(DAYS.map((day, index) => [day, index]))

function getState(): ExportState {
  window.__fbScrape ??= {
    running: false,
    aborted: false,
    phase: 'idle',
    batch: 0,
    harvest: null,
  }
  return window.__fbScrape
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function setCaptureContext(phase: CapturePhase, batch = 0) {
  const state = getState()
  state.phase = phase
  state.batch = batch
}

function findLog() {
  const log = document.querySelector<HTMLElement>('[role="log"][aria-label^="Messages in conversation with"]')
    ?? document.querySelector<HTMLElement>('[role="log"]')

  if (!log) {
    throw new Error("Couldn't find the Messenger conversation log. Open a conversation first.")
  }

  return log
}

function conversationName() {
  const log = document.querySelector<HTMLElement>('[role="log"][aria-label^="Messages in conversation with"]')
  const label = log?.getAttribute('aria-label') ?? ''
  return label.replace(/^Messages in conversation with /, '').trim() || null
}

function waitForUserScroll(log: HTMLElement, { timeoutMs = 60_000 } = {}) {
  return new Promise<HTMLElement>((resolve, reject) => {
    let settled = false
    let timer = 0

    const cleanup = () => {
      document.removeEventListener('scroll', handler, true)
      window.clearTimeout(timer)
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const handler = (event: Event) => {
      const target = event.target === document ? document.scrollingElement : event.target
      if (!(target instanceof HTMLElement)) return
      if (!log.contains(target)) return

      settle(() => resolve(target))
    }

    document.addEventListener('scroll', handler, true)
    timer = window.setTimeout(() => {
      settle(() => reject(new Error('Timed out waiting for a manual chat scroll. Scroll the conversation once and try again.')))
    }, timeoutMs)
  })
}

function timeKey(timeStr: string) {
  const match = /^(\w+)\s+(\d{1,2}):(\d{2})(am|pm)$/i.exec(timeStr.trim())
  if (!match) return null

  const day = DAY_INDEX[match[1] as keyof typeof DAY_INDEX]
  if (day === undefined) return null

  let hour = Number.parseInt(match[2], 10) % 12
  if (match[4].toLowerCase() === 'pm') hour += 12

  const minute = Number.parseInt(match[3], 10)
  return day * 1440 + hour * 60 + minute
}

function parseLabel(label: string): ParsedLabel | null {
  const match = LABEL_RE.exec(label)
  if (!match) return null

  return {
    time: match[1].trim(),
    sender: match[2].trim(),
    body: match[3],
  }
}

function captureMessage(element: Element, store: HarvestStore) {
  const label = element.getAttribute('aria-label')
  if (!label || store.messages.has(label)) return

  const state = getState()
  const seq = store.order.length
  const parsed = parseLabel(label)

  const record: CapturedRecord = parsed
    ? {
        seq,
        phase: state.phase,
        batch: state.batch,
        time: parsed.time,
        sender: parsed.sender,
        body: parsed.body,
      }
    : {
        seq,
        phase: state.phase,
        batch: state.batch,
        raw: label,
        unparsed: true,
      }

  store.messages.set(label, record)
  store.order.push(label)
}

function scanDom(store: HarvestStore, label = 'scan') {
  const found = document.querySelectorAll('[aria-roledescription="message"]')
  const before = store.messages.size

  for (const element of found) {
    captureMessage(element, store)
  }

  const added = store.messages.size - before
  console.log(`[fb-harvest] ${label}: ${found.length} in DOM, ${added} new -> total ${store.messages.size}`)
}

function startHarvester(log: HTMLElement, { logEvery = 10 } = {}) {
  const store: HarvestStore = {
    messages: new Map(),
    order: [],
    startedAt: Date.now(),
    conversation: conversationName(),
    lastLoggedCount: 0,
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        if (mutation.target.matches('[aria-roledescription="message"]')) {
          captureMessage(mutation.target, store)
        }
      }

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.matches('[aria-roledescription="message"]')) {
          captureMessage(node, store)
        }

        const nested = node.querySelectorAll('[aria-roledescription="message"]')
        for (const element of nested) {
          captureMessage(element, store)
        }
      }
    }

    const count = store.messages.size
    if (count - store.lastLoggedCount >= logEvery) {
      console.log(`[fb-harvest] captured ${count} messages`)
      store.lastLoggedCount = count
    }
  })

  observer.observe(log, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  })

  setCaptureContext('initial', 0)
  scanDom(store, 'initial')
  return { observer, store }
}

function orderMessages(store: HarvestStore) {
  const all = [...store.messages.values()]
  const parsed = all.filter((message): message is ParsedRecord => !('unparsed' in message))
  const unparsed = all.filter((message): message is UnparsedRecord => 'unparsed' in message)

  const history = parsed
    .filter((message) => message.phase === 'top' || message.phase === 'top-settle')
    .sort((a, b) => {
      if (a.batch !== b.batch) return b.batch - a.batch

      const keyA = timeKey(a.time)
      const keyB = timeKey(b.time)
      if (keyA !== null && keyB !== null && keyA !== keyB) return keyA - keyB

      return a.seq - b.seq
    })

  const recent = parsed
    .filter((message) => message.phase !== 'top' && message.phase !== 'top-settle')
    .sort((a, b) => {
      if (a.batch !== b.batch) return a.batch - b.batch

      const keyA = timeKey(a.time)
      const keyB = timeKey(b.time)
      if (keyA !== null && keyB !== null && keyA !== keyB) return keyA - keyB

      return a.seq - b.seq
    })

  return { parsed: [...history, ...recent], unparsed }
}

async function scrollToBottom(scroller: HTMLElement, store: HarvestStore, options: ScrollOptions = {}) {
  const {
    settlePause = 800,
    settleChecks = 4,
    maxSteps = 500,
    wiggles = 3,
  } = options

  let lastHeight = scroller.scrollHeight
  let lastCount = store.messages.size
  let stable = 0
  let step = 0

  while (step < maxSteps) {
    if (getState().aborted) break

    setCaptureContext('bottom', step)
    scroller.scrollTop = scroller.scrollHeight + 10_000
    await sleep(settlePause)

    const height = scroller.scrollHeight
    const count = store.messages.size
    const grew = height > lastHeight
    const captured = count > lastCount

    if (grew || captured) {
      stable = 0
      lastHeight = height
      lastCount = count
    } else {
      stable += 1
      if (stable >= settleChecks) break
    }

    step += 1
  }

  for (let wiggle = 0; wiggle < wiggles; wiggle += 1) {
    if (getState().aborted) break

    setCaptureContext('bottom', maxSteps + wiggle)
    scroller.scrollTop = Math.max(0, scroller.scrollTop - 600)
    await sleep(500)
    scroller.scrollTop = scroller.scrollHeight + 10_000
    await sleep(700)
  }

  await sleep(500)
}

async function scrollToTop(scroller: HTMLElement, store: HarvestStore, options: TopScrollOptions = {}) {
  const {
    stepPause = 700,
    settle = 4,
    maxSteps = 2000,
  } = options

  let lastHeight = scroller.scrollHeight
  let lastCount = store.messages.size
  let stableCount = 0
  let step = 0

  while (step < maxSteps) {
    if (getState().aborted) break

    setCaptureContext('top', step)
    scroller.scrollTop = 0
    await sleep(stepPause)

    const height = scroller.scrollHeight
    const count = store.messages.size
    const grew = height > lastHeight
    const captured = count > lastCount

    if (grew || captured) {
      stableCount = 0
      lastHeight = height
      lastCount = count
    } else {
      stableCount += 1
      if (stableCount >= settle) break
    }

    step += 1
  }
}

export async function exportFacebookConversation(options: ExportOptions = {}): Promise<ExportResult> {
  const {
    bottomOptions = {},
    topOptions = {},
    calibrationTimeoutMs = 60_000,
  } = options

  const state = getState()
  if (state.running) {
    throw new Error('A scrape is already running on this tab.')
  }

  state.running = true
  state.aborted = false

  let harvest: HarvestSession | null = null

  try {
    const log = findLog()
    const scroller = await waitForUserScroll(log, { timeoutMs: calibrationTimeoutMs })

    harvest = startHarvester(log)
    state.harvest = { observer: harvest.observer }

    await scrollToBottom(scroller, harvest.store, bottomOptions)
    await sleep(500)
    setCaptureContext('bottom', Number.MAX_SAFE_INTEGER)
    scanDom(harvest.store, 'after-bottom')

    await scrollToTop(scroller, harvest.store, topOptions)

    await sleep(700)
    setCaptureContext('top-settle', Number.MAX_SAFE_INTEGER - 1)
    scanDom(harvest.store, 'at-top')

    await sleep(700)
    setCaptureContext('top-settle', Number.MAX_SAFE_INTEGER)
    scanDom(harvest.store, 'final')
  } catch (error) {
    state.running = false
    if (harvest) {
      harvest.observer.disconnect()
      state.harvest = null
    }
    throw error
  }

  harvest.observer.disconnect()
  state.harvest = null
  state.running = false

  const ordered = orderMessages(harvest.store)
  const messages = ordered.parsed.map(({ time, sender, body }) => ({ time, sender, body }))
  const unparsed = ordered.unparsed.map(({ raw }) => ({ raw }))

  return {
    conversation: harvest.store.conversation,
    capturedAt: new Date().toISOString(),
    durationMs: Date.now() - harvest.store.startedAt,
    messageCount: messages.length,
    unparsedCount: unparsed.length,
    messages,
    unparsed,
  }
}

export function stopFacebookConversationExport() {
  const state = getState()
  state.aborted = true

  if (state.harvest) {
    state.harvest.observer.disconnect()
    state.harvest = null
  }

  state.running = false
}
