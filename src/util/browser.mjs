// Cross-platform "open this URL in the user's default browser".

import { spawn } from 'node:child_process'
import { platform } from 'node:os'

export function openInBrowser(url) {
  if (!url) return false
  const p = platform()
  try {
    if (p === 'win32') {
      // `start` is a cmd built-in; the empty "" is the window title.
      spawn('cmd', ['/c', 'start', '""', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref()
    } else if (p === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
    return true
  } catch {
    return false
  }
}
