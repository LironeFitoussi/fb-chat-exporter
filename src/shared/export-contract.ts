export type ExportRequestMessage = {
  type: 'FB_EXPORT_REQUEST'
}

export type ExportSuccessMessage = {
  ok: true
  data: ExportResult
}

export type ExportErrorMessage = {
  ok: false
  error: string
}

export type ExportResponseMessage = ExportSuccessMessage | ExportErrorMessage

export type ExportMessage = ExportRequestMessage

export type ExportedMessage = {
  time: string
  sender: string
  body: string
}

export type UnparsedMessage = {
  raw: string
}

export type ExportResult = {
  conversation: string | null
  capturedAt: string
  durationMs: number
  messageCount: number
  unparsedCount: number
  messages: ExportedMessage[]
  unparsed: UnparsedMessage[]
}
