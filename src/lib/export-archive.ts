import type { ExportResult } from '@/shared/export-contract'

const STORAGE_KEY = 'fb-chat-export-archive'
const MAX_ARCHIVED_EXPORTS = 20

export type ArchivedExport = {
  id: string
  savedAt: string
  data: ExportResult
}

type ArchiveShape = {
  [STORAGE_KEY]?: ArchivedExport[]
}

function createArchiveId(result: ExportResult) {
  const conversation = (result.conversation ?? 'conversation')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

  return `${conversation || 'conversation'}__${result.capturedAt}`
}

export async function loadArchivedExports() {
  const stored = await chrome.storage.local.get(STORAGE_KEY) as ArchiveShape
  return stored[STORAGE_KEY] ?? []
}

export async function saveArchivedExport(result: ExportResult) {
  const archive = await loadArchivedExports()
  const entry: ArchivedExport = {
    id: createArchiveId(result),
    savedAt: new Date().toISOString(),
    data: result,
  }

  const nextArchive = [
    entry,
    ...archive.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_ARCHIVED_EXPORTS)

  await chrome.storage.local.set({
    [STORAGE_KEY]: nextArchive,
  })

  return nextArchive
}
