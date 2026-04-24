import { exportFacebookConversation, stopFacebookConversationExport } from '@/lib/facebook-export'
import type { ExportMessage, ExportResponseMessage } from '@/shared/export-contract'

chrome.runtime.onMessage.addListener((message: ExportMessage, _sender, sendResponse) => {
  if (message.type !== 'FB_EXPORT_REQUEST') {
    return false
  }

  void (async () => {
    try {
      const data = await exportFacebookConversation()
      const response: ExportResponseMessage = { ok: true, data }
      sendResponse(response)
    } catch (error) {
      const response: ExportResponseMessage = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown scraping error',
      }
      sendResponse(response)
    }
  })()

  return true
})

window.addEventListener('beforeunload', () => {
  stopFacebookConversationExport()
})

console.log('[fb-chat-exporter] content script ready')
