const imageExtension = /\.(?:avif|apng|bmp|dib|gif|heic|heif|ico|jfif|jpe?g|jxl|png|svg|tiff?|webp)$/i

function isImage(file) {
  return file.type.startsWith('image/') || imageExtension.test(file.name)
}

function transferFiles(transfer) {
  if (!transfer) return []
  if (transfer.files?.length) return Array.from(transfer.files)
  return Array.from(transfer.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(Boolean)
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function inlineImageSources(html) {
  if (!/<img\b/i.test(html)) return []
  // Template contents stay inert, including remote images and other resources.
  const template = document.createElement('template')
  template.innerHTML = html
  return Array.from(template.content.querySelectorAll('img[src]'), img => img.getAttribute('src').trim())
    .filter(src => /^data:image\/[\w.+-]+(?:;[^,]*)?,/i.test(src))
}

export function wireIntake({ dropZone, input, pasteButton, onFiles, onMessage, onClipboardPending }) {
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const shortcut = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘V' : 'Ctrl+V'
  const pasteHelp = `Copy an image, then press ${shortcut} on this page, or use the file picker.`
  let dragDepth = 0
  let clipboardIndex = 0
  let pendingReads = 0

  function clipboardFile(blob) {
    const extension = blob.type.split(/[;+]/, 1)[0].slice(6).replace('jpeg', 'jpg')
    return new File([blob], `Pasted image ${++clipboardIndex}.${extension}`, { type: blob.type })
  }

  async function inlineImages(sources) {
    const files = []
    for (const src of sources) {
      try {
        const response = await fetch(src)
        files.push(clipboardFile(await response.blob()))
      } catch {
        // A malformed data URL should not discard the other images in the paste.
      }
    }
    return files
  }

  async function readClipboardFiles() {
    const items = await navigator.clipboard.read()
    const files = []
    let readError
    for (const item of items) {
      // Prefer image bytes over HTML when both represent the same clipboard item.
      const types = item.types.filter(type => type.startsWith('image/'))
      if (item.types.includes('text/html')) types.push('text/html')
      for (const type of types) {
        try {
          const blob = await item.getType(type)
          if (type === 'text/html') files.push(...await inlineImages(inlineImageSources(await blob.text())))
          else files.push(clipboardFile(blob))
          break
        } catch (error) {
          readError = error
        }
      }
    }
    if (!files.length && readError) throw readError
    return files
  }

  async function importClipboard(readFiles, emptyMessage) {
    pendingReads += 1
    if (pendingReads === 1) onClipboardPending?.(true)
    try {
      const files = await readFiles()
      if (files.length) onFiles(files)
      else onMessage(emptyMessage)
    } catch {
      onMessage(pasteHelp)
    } finally {
      pendingReads -= 1
      if (pendingReads === 0) onClipboardPending?.(false)
    }
  }

  function receive(files) {
    const images = files.filter(isImage)
    if (!images.length) {
      onMessage('Choose an image file, such as a JPG or PNG.')
      return
    }
    onFiles(images)
    const skipped = files.length - images.length
    if (skipped) onMessage(`Skipped ${skipped} non-image ${skipped === 1 ? 'file' : 'files'}.`)
  }

  function resetDrag() {
    dragDepth = 0
    delete dropZone.dataset.dragging
  }

  input.addEventListener('change', () => {
    const files = Array.from(input.files || [])
    input.value = ''
    if (files.length) receive(files)
  }, options)

  dropZone.addEventListener('dragenter', event => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth += 1
    dropZone.dataset.dragging = 'true'
  }, options)

  dropZone.addEventListener('dragleave', () => {
    if (dragDepth && --dragDepth === 0) resetDrag()
  }, options)

  dropZone.addEventListener('dragover', event => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = isFileDrag(event) ? 'copy' : 'none'
  }, options)

  dropZone.addEventListener('drop', event => {
    event.preventDefault()
    resetDrag()
    if (isFileDrag(event)) receive(transferFiles(event.dataTransfer))
  }, options)

  // Keep a misplaced file drop from navigating away from the current document.
  window.addEventListener('dragover', event => {
    if (!event.defaultPrevented && isFileDrag(event)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'none'
    }
  }, options)
  window.addEventListener('drop', event => {
    if (isFileDrag(event)) event.preventDefault()
    resetDrag()
  }, options)
  window.addEventListener('dragend', resetDrag, options)

  window.addEventListener('paste', event => {
    const transfer = event.clipboardData
    if (!transfer || event.defaultPrevented || document.querySelector('dialog[open]')) return
    const target = event.target
    const editing = target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea'))
    if (editing && Array.from(transfer.types).some(type => type === 'text/plain' || type === 'text/html')) return
    const files = transferFiles(transfer)
    if (files.length) {
      event.preventDefault()
      receive(files)
      return
    }
    const sources = inlineImageSources(transfer.getData('text/html'))
    if (!sources.length) return
    event.preventDefault()
    importClipboard(() => inlineImages(sources), 'This pasted image could not be read. Try copying the image itself.')
  }, options)

  pasteButton.addEventListener('click', () => {
    if (!navigator.clipboard?.read) {
      onMessage(pasteHelp)
      return
    }
    importClipboard(readClipboardFiles, 'Copy an image or screenshot to the clipboard, then paste again.')
  }, options)

  return () => {
    controller.abort()
    resetDrag()
  }
}
