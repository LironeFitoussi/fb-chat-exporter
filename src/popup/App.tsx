import { Download, History, LoaderCircle, MessageCircleMore } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { loadArchivedExports, saveArchivedExport, type ArchivedExport } from '@/lib/export-archive'
import type { ExportResult, ExportResponseMessage } from '@/shared/export-contract'

type Status =
  | { tone: 'idle'; text: string }
  | { tone: 'info'; text: string }
  | { tone: 'success'; text: string }
  | { tone: 'error'; text: string }

function isSupportedMessengerUrl(url?: string) {
  if (!url) return false
  return url.startsWith('https://www.facebook.com/messages/')
    || url.startsWith('https://www.messenger.com/')
}

function sanitizeFilePart(value: string | null | undefined, fallback: string) {
  const normalized = (value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()

  return normalized || fallback
}

function buildFileName(result: ExportResult) {
  const name = sanitizeFilePart(result.conversation, 'conversation')
  const timestamp = result.capturedAt
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '')
  return `facebook-chat-${name}-${timestamp}.json`
}

async function downloadExport(result: ExportResult) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  try {
    await chrome.downloads.download({
      url,
      filename: buildFileName(result),
      saveAs: false,
    })
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000)
  }
}

export default function App() {
  const [isLoading, setIsLoading] = useState(false)
  const [isReExportingId, setIsReExportingId] = useState<string | null>(null)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [supportedTab, setSupportedTab] = useState(false)
  const [lastExport, setLastExport] = useState<ExportResult | null>(null)
  const [savedExports, setSavedExports] = useState<ArchivedExport[]>([])
  const [status, setStatus] = useState<Status>({
    tone: 'idle',
    text: 'Open a chat, go to the bottom, then export.',
  })

  useEffect(() => {
    void (async () => {
      const archive = await loadArchivedExports()
      setSavedExports(archive)
      if (archive[0]) {
        setLastExport(archive[0].data)
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      setActiveTabId(tab?.id ?? null)
      setSupportedTab(isSupportedMessengerUrl(tab?.url))

      if (!tab?.id) {
        setStatus({
          tone: 'error',
          text: 'No active tab was found.',
        })
        return
      }

      if (!isSupportedMessengerUrl(tab.url)) {
      setStatus({
        tone: 'error',
        text: 'Open Messenger in the active tab first.',
      })
      }
    })()
  }, [])

  async function startExport() {
    if (!activeTabId) {
      setStatus({ tone: 'error', text: 'No active Messenger tab is available.' })
      return
    }

    setIsLoading(true)
    setStatus({
      tone: 'info',
      text: 'Scroll the chat once so the scraper can lock on.',
    })

    try {
      const response = await chrome.tabs.sendMessage(activeTabId, {
        type: 'FB_EXPORT_REQUEST',
      }) as ExportResponseMessage | undefined

      if (!response) {
        throw new Error('The content script did not respond. Reload the Messenger tab and try again.')
      }

      if (!response.ok) {
        throw new Error(response.error)
      }

      await downloadExport(response.data)
      const updatedArchive = await saveArchivedExport(response.data)
      setSavedExports(updatedArchive)
      setLastExport(response.data)
      setStatus({
        tone: 'success',
        text: `${response.data.messageCount} messages exported.`,
      })
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Export failed.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function reExportSavedConversation(entry: ArchivedExport) {
    setIsReExportingId(entry.id)

    try {
      await downloadExport(entry.data)
      setLastExport(entry.data)
      setStatus({
        tone: 'success',
        text: `Re-exported ${entry.data.conversation ?? 'saved conversation'}.`,
      })
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Re-export failed.',
      })
    } finally {
      setIsReExportingId(null)
    }
  }

  return (
    <main className="min-w-[360px] bg-background px-3 py-3 text-foreground">
      <Card className="overflow-hidden border-border bg-card shadow-none">
        <CardHeader className="gap-4 border-b border-border bg-[linear-gradient(180deg,var(--meta-blue-faint),transparent)] pb-4">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="rounded-sm">
              Messenger Export
            </Badge>
            <Badge variant="meta" className="rounded-sm">
              json
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="font-[Arial] text-[24px] leading-[0.95] tracking-[-0.06em]">
                  Export the current chat.
                </CardTitle>
                <p className="max-w-[220px] text-[12px] leading-5 text-muted-foreground">
                  shadcn base, monochrome first, with a small Meta blue accent.
                </p>
              </div>

              <div className="grid gap-2 pt-1" aria-hidden="true">
                <span className="h-2 w-16 rounded-full bg-foreground" />
                <span className="h-2 w-10 rounded-full bg-[var(--meta-blue)]" />
                <span className="h-2 w-14 rounded-full bg-border" />
              </div>
            </div>

            <div className="flex gap-2">
              <Badge variant="secondary" className="rounded-sm">live tab</Badge>
              <Badge variant="secondary" className="rounded-sm">auto download</Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4">
          <div
            className={[
              'rounded-lg border px-3 py-2 text-[12px] leading-5',
              status.tone === 'error'
                ? 'border-destructive/20 bg-destructive/5 text-destructive'
                : status.tone === 'success'
                  ? 'border-[var(--meta-blue-soft)] bg-[var(--meta-blue-faint)] text-foreground'
                  : status.tone === 'info'
                    ? 'border-[var(--meta-blue-soft)] bg-[var(--meta-blue-faint)] text-foreground'
                    : 'border-border bg-secondary text-muted-foreground',
            ].join(' ')}
          >
            {status.text}
          </div>

          <Button
            type="button"
            onClick={() => void startExport()}
            disabled={!supportedTab || isLoading}
            className="h-11 w-full rounded-lg text-[13px] tracking-[-0.02em]"
          >
            {isLoading ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Scraping conversation
              </>
            ) : (
              <>
                <Download className="size-4" />
                Export current conversation
              </>
            )}
          </Button>

          <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <div className="space-y-1">
              <span className="block h-px bg-border" />
              <span>Open</span>
            </div>
            <div className="space-y-1">
              <span className="block h-px bg-[var(--meta-blue-soft)]" />
              <span>Scroll</span>
            </div>
            <div className="space-y-1">
              <span className="block h-px bg-border" />
              <span>Download</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {lastExport && (
        <Card className="mt-3 border-border bg-card shadow-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div className="flex items-center gap-2">
              <MessageCircleMore className="size-4 text-[var(--meta-blue)]" />
              <CardTitle className="text-[13px] uppercase tracking-[0.12em] text-muted-foreground">
                Last Export
              </CardTitle>
            </div>
            <Badge variant="outline" className="rounded-sm">ready</Badge>
          </CardHeader>

          <CardContent className="grid gap-2 pt-0">
            <div className="rounded-lg border border-border bg-secondary p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Conversation
              </div>
              <div className="mt-1 text-[13px] font-medium leading-5 text-foreground">
                {lastExport.conversation ?? 'Unknown conversation'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Messages
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {lastExport.messageCount}
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Unparsed
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {lastExport.unparsedCount}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-3 border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <History className="size-4 text-[var(--meta-blue)]" />
            <CardTitle className="text-[13px] uppercase tracking-[0.12em] text-muted-foreground">
              Saved
            </CardTitle>
          </div>
          <Badge variant="outline" className="rounded-sm">
            {savedExports.length}
          </Badge>
        </CardHeader>

        <CardContent className="grid gap-2 pt-0">
          {savedExports.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
              Your exported conversations will be saved here for quick re-export.
            </div>
          ) : (
            savedExports.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {entry.data.conversation ?? 'Unknown conversation'}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {entry.data.messageCount} messages
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-md"
                  disabled={isReExportingId === entry.id}
                  onClick={() => void reExportSavedConversation(entry)}
                >
                  {isReExportingId === entry.id ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  Again
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  )
}
