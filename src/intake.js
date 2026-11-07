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

export function wireIntake({ dropZone, input, pasteButton, onFiles, onMessage }) {
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const shortcut = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘V' : 'Ctrl+V'
  const pasteHelp = `Copy an image, then press ${shortcut} on this page, or use the file picker.`
  let dragDepth = 0
  let clipboardIndex = 0

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
    receive(transferFiles(event.dataTransfer))
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
    const files = transferFiles(event.clipboardData)
    if (!files.length) return
    event.preventDefault()
    receive(files)
  }, options)

  pasteButton.addEventListener('click', async () => {
    if (!navigator.clipboard?.read) {
      onMessage(pasteHelp)
      return
    }
    let files
    try {
      const items = await navigator.clipboard.read()
      files = []
      for (const item of items) {
        // A single copied image can have several representations.
        const type = item.types.find(value => value.startsWith('image/'))
        if (!type) continue
        const blob = await item.getType(type)
        const extension = type.slice(6).split('+')[0].replace('jpeg', 'jpg')
        files.push(new File([blob], `Pasted image ${++clipboardIndex}.${extension}`, { type }))
      }
    } catch {
      onMessage(pasteHelp)
      return
    }
    if (files.length) onFiles(files)
    else onMessage('Your clipboard has no image. Copy an image or a screenshot, then paste again.')
  }, options)

  return () => {
    controller.abort()
    resetDrag()
  }
}
