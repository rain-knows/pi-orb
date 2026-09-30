/*
 * Floating renderer port from rain-knows/deepseek-harness-orb, MIT, commit
 * 72f1d738458a223696685a909e806b683eff5885:
 * apps/desktop/renderer/floating.js. See THIRD_PARTY_NOTICES.md §3.5 and
 * doc/frontend-port.md for the Pi host substitutions. The DSH RPC, stream and
 * iframe are deliberately replaced by the existing restricted window.orb API.
 */
const api = window.orb
const COLLAPSE_MS = 180
const ANIMATION_MS = 300
const DOCK_HOVER_DELAY_MS = 800
const DOCK_DRAG_OFF_PX = 24
const DARK_ATTRIBUTE = 'data-ds-dark-theme'
const COMPOSER_MIN_PX = 72
const COMPOSER_LINE_PX = 20
const COMPOSER_EXTRA_LINES = 3
const COMPOSER_MAX_PX = COMPOSER_MIN_PX + COMPOSER_LINE_PX * COMPOSER_EXTRA_LINES

function applyColorScheme(scheme) {
  const dark = scheme === 'dark'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.toggleAttribute(DARK_ATTRIBUTE, dark)
}

function editableTarget(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement
  if (element === null || element === undefined || typeof element.closest !== 'function') return false
  return element.closest('input, textarea, [contenteditable="true"]') !== null
}

function isComposing(event) {
  return event.isComposing === true || event.keyCode === 229
}

function promptText(prompt) {
  const raw = prompt.innerText ?? prompt.textContent ?? ''
  return raw.replaceAll('\u00a0', ' ')
}

function insertPlainText(prompt, text) {
  if (text === '') return
  if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return
  prompt.append(text)
}

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
}

function formatHistoryDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function main() {
  if (!api) throw new Error('The Orb bridge is unavailable.')
  const el = (id) => document.getElementById(id)
  const panel = el('panel')
  const ball = el('ball')
  const dockTab = el('dock-tab')
  const transcript = el('transcript')
  const historyButton = el('history')
  const historyList = el('history-list')
  const permissionRoot = el('permission')
  const permissionButton = el('permission-button')
  const permissionMenu = el('permission-menu')
  const permissionLabel = el('permission-label')
  const prompt = el('prompt')
  const composer = el('composer')
  const stop = el('stop')
  const status = el('status')
  const selectionChip = el('selection-chip')
  const selectionChipText = el('selection-chip-text')
  const selectionChipDismiss = el('selection-chip-dismiss')
  const accessSheet = el('access-sheet')
  const previewSheet = el('preview-sheet')
  const modelSheet = el('model-sheet')
  const workspaceGate = el('workspace-gate')
  const transcriptEmpty = el('transcript-empty')
  const newConversationButton = el('new-conversation')
  let snapshot = await api.getStatus()
  let desktopTask = snapshot.desktopTask
  let selectionContext = await api.getSelectionContext()
  let preview
  let running = snapshot.busy
  let expanded = false
  let pinned = false
  let dragging = false
  let collapsing = false
  let skipClick = false
  let docked
  let dockHoverArmed = true
  let dockHoverTimer
  let dockPointerInside = false
  let suppressExpand = false
  let skipDockCommit = false
  let pointer
  let lastOrigin
  let collapseTimer
  let collapseFrame
  let historyOpen = false
  let permissionOpen = false
  let activeSheet
  let streaming = ''
  let streamedMessage
  let messageCount = 0
  let noticeTimer

  document.documentElement.lang = 'en'
  el('input-label').textContent = 'Message'
  prompt.dataset.placeholder = 'Ask anything'
  prompt.classList.add('prompt-empty')
  stop.setAttribute('aria-label', 'Stop response')
  newConversationButton.setAttribute('aria-label', 'New conversation')
  historyButton.setAttribute('aria-label', 'Conversation history')
  selectionChipDismiss.setAttribute('aria-label', 'Remove selected text')
  selectionChipDismiss.textContent = '\u00d7'
  const theme = matchMedia('(prefers-color-scheme: dark)')
  applyColorScheme(theme.matches ? 'dark' : 'light')
  theme.addEventListener('change', () => applyColorScheme(theme.matches ? 'dark' : 'light'))

  function showNotice(message) {
    status.textContent = message ?? ''
    if (noticeTimer !== undefined) clearTimeout(noticeTimer)
    if (message) noticeTimer = setTimeout(() => { status.textContent = '' }, 6000)
  }

  function report(error) {
    showNotice(error instanceof Error ? error.message : String(error))
  }

  function draftOverflows() {
    return prompt.scrollHeight > prompt.clientHeight + 1
  }

  function syncComposerHeight() {
    const empty = promptText(prompt).trim() === ''
    prompt.classList.toggle('prompt-empty', empty)
    if (empty) {
      document.body.classList.remove('composer-capped')
      document.body.style.setProperty('--composer-height', 'var(--ball)')
      return
    }
    document.body.classList.remove('composer-capped')
    let height = COMPOSER_MIN_PX
    for (;;) {
      document.body.style.setProperty('--composer-height', `${height}px`)
      if (!draftOverflows() || height >= COMPOSER_MAX_PX) break
      height = Math.min(COMPOSER_MAX_PX, height + COMPOSER_LINE_PX)
    }
    document.body.classList.toggle('composer-capped', draftOverflows())
  }

  function clearPrompt() {
    prompt.textContent = ''
    prompt.classList.add('prompt-empty')
    document.body.classList.remove('composer-capped')
    document.body.style.setProperty('--composer-height', 'var(--ball)')
  }

  function syncEmpty() {
    workspaceGate.hidden = snapshot.configured
    transcriptEmpty.hidden = !snapshot.configured || messageCount > 0
    composer.hidden = !snapshot.configured
    newConversationButton.disabled = !snapshot.configured || running
    historyButton.disabled = !snapshot.configured
  }

  function clearMessages() {
    for (const node of [...transcript.children]) {
      if (node !== workspaceGate && node !== transcriptEmpty) node.remove()
    }
    streamedMessage = undefined
    streaming = ''
    messageCount = 0
    syncEmpty()
  }

  function addMessage(role, text) {
    const article = document.createElement('article')
    article.className = `orb-message orb-message--${role}`
    const label = document.createElement('strong')
    label.textContent = role === 'user' ? 'You' : role === 'error' ? 'Error' : 'Orb'
    const copy = document.createElement('p')
    copy.textContent = text
    article.append(label, copy)
    transcript.append(article)
    messageCount += 1
    syncEmpty()
    transcript.scrollTop = transcript.scrollHeight
    return article
  }

  function appendAssistant(text) {
    if (!streamedMessage) streamedMessage = addMessage('assistant', '')
    streamedMessage.querySelector('p').textContent = text
    transcript.scrollTop = transcript.scrollHeight
  }

  function setRunning(next) {
    running = next
    document.body.classList.toggle('running', running)
    stop.hidden = !expanded || !running
    newConversationButton.disabled = !snapshot.configured || running
    if (next) {
      if (!el('thinking')) {
        const thinking = document.createElement('div')
        thinking.id = 'thinking'
        thinking.className = 'orb-thinking'
        thinking.innerHTML = '<i></i><i></i><i></i><span>Thinking</span>'
        transcript.append(thinking)
      }
    } else {
      el('thinking')?.remove()
      streaming = ''
      streamedMessage = undefined
    }
  }

  function applyDirection(state) {
    document.body.classList.toggle('expand-left', state.horizontal === 'left')
    document.body.classList.toggle('expand-right', state.horizontal === 'right')
    document.body.classList.toggle('expand-up', state.vertical === 'up')
    document.body.classList.toggle('expand-down', state.vertical === 'down')
  }

  function clearDockHoverTimer() {
    if (dockHoverTimer === undefined) return
    clearTimeout(dockHoverTimer)
    dockHoverTimer = undefined
  }

  function applyDocked(side) {
    const next = side === 'left' || side === 'right' ? side : undefined
    const becameDocked = docked === undefined && next !== undefined
    docked = next
    document.body.classList.toggle('docked', next !== undefined)
    document.body.classList.toggle('docked-left', next === 'left')
    document.body.classList.toggle('docked-right', next === 'right')
    clearDockHoverTimer()
    if (next === undefined) {
      dockTab.hidden = true
      dockHoverArmed = true
      return
    }
    if (becameDocked) {
      dockHoverArmed = false
      dockHoverTimer = setTimeout(() => {
        dockHoverTimer = undefined
        dockHoverArmed = true
        if (dockPointerInside) void unsnapDocked()
      }, DOCK_HOVER_DELAY_MS)
    }
    dockTab.hidden = false
  }

  function applyDockedFrom(result) {
    if (result === undefined || result === null) return
    applyDocked(result.docked)
  }

  async function moveBall(x, y) {
    applyDockedFrom(await api.moveFloatingBall(x, y))
  }

  async function clampBall() {
    applyDockedFrom(await api.clampFloatingBall())
  }

  async function unsnapDocked() {
    if (docked === undefined) return
    suppressExpand = true
    if (dragging) skipDockCommit = true
    applyDocked(undefined)
    applyDockedFrom(await api.unsnapFloatingBall())
  }

  async function setExpanded(next, force = false) {
    if (collapseTimer !== undefined) {
      clearTimeout(collapseTimer)
      collapseTimer = undefined
    }
    if (collapseFrame !== undefined) {
      clearTimeout(collapseFrame)
      collapseFrame = undefined
    }
    if (next) {
      const state = await api.setFloatingExpanded(true)
      applyDocked(undefined)
      applyDirection(state)
      panel.hidden = false
      expanded = true
      document.body.classList.add('expanded')
      stop.hidden = !running
      return
    }
    if (!force && (pinned || running || hasSelectionChip() || activeSheet || historyOpen)) return
    expanded = false
    document.body.classList.remove('expanded')
    if (docked !== undefined) dockTab.hidden = false
    stop.hidden = true
    if (force) {
      panel.hidden = true
      await api.setFloatingExpanded(false)
      return
    }
    collapseFrame = setTimeout(() => {
      collapseFrame = undefined
      panel.hidden = true
      void api.setFloatingExpanded(false)
    }, ANIMATION_MS)
  }

  function ballGrabOffset(event) {
    const rect = ball.getBoundingClientRect()
    return { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
  }

  function hasSelectionChip() { return selectionContext !== null && selectionContext !== undefined }

  function scheduleCollapse() {
    if (pinned || running || dragging || hasSelectionChip() || activeSheet || historyOpen) return
    if (collapseTimer !== undefined) clearTimeout(collapseTimer)
    collapseTimer = setTimeout(() => {
      collapseTimer = undefined
      void setExpanded(false)
    }, COLLAPSE_MS)
  }

  function setHistoryOpen(next) {
    historyOpen = next
    historyButton.setAttribute('aria-pressed', String(next))
    historyList.hidden = !next
    transcript.hidden = next
    if (next) { setPermissionOpen(false); closeSheet() }
  }

  function setPermissionOpen(next) {
    permissionOpen = next
    permissionButton.setAttribute('aria-expanded', String(next))
    permissionMenu.hidden = !next
    if (next) setHistoryOpen(false)
  }

  function closeSheet() {
    activeSheet = undefined
    for (const sheet of [accessSheet, previewSheet, modelSheet]) sheet.hidden = true
  }

  function showSheet(sheet) {
    setHistoryOpen(false)
    setPermissionOpen(false)
    closeSheet()
    activeSheet = sheet
    sheet.hidden = false
  }

  function renderPermission() {
    permissionLabel.textContent = desktopTask.authorized ? 'Desktop access' : 'Orb access'
    el('access-state').textContent = desktopTask.authorized
      ? `Approved · ${desktopTask.actionsUsed}/${desktopTask.actionLimit} actions${desktopTask.scope ? ` · ${desktopTask.scope}` : ''}`
      : desktopTask.stoppedReason || 'Desktop actions require approval for each task.'
    el('access-target').textContent = desktopTask.target?.title || 'No target selected'
    el('revoke').disabled = !desktopTask.authorized
  }

  function setSelectionContext(context) {
    selectionContext = context
    selectionChip.hidden = !context
    document.body.classList.toggle('has-selection-chip', Boolean(context))
    const summary = context?.text.replace(/\s+/g, ' ').trim() ?? ''
    selectionChipText.textContent = context ? `${context.sourceLabel ?? 'Another application'} · ${summary.length > 72 ? `${summary.slice(0, 69)}...` : summary}` : ''
    selectionChip.title = context?.text ?? ''
  }

  async function refreshStatus() {
    snapshot = await api.getStatus()
    desktopTask = snapshot.desktopTask
    renderPermission()
    syncEmpty()
    return snapshot
  }

  async function chooseWorkspace() {
    const picked = await api.chooseWorkspace()
    if (!picked.ok) { if (picked.message) showNotice(picked.message); return }
    snapshot = await api.setWorkspace(picked.resolved ?? '', false)
    desktopTask = snapshot.desktopTask
    renderPermission()
    syncEmpty()
    if (snapshot.problem) showNotice(snapshot.problem)
  }

  async function sendPrompt() {
    const instruction = promptText(prompt).trim()
    if ((!instruction && !selectionContext) || running || !snapshot.configured) return
    const text = selectionContext
      ? `${instruction || 'Please help me understand this selected text.'}\n\n[Selected text from ${selectionContext.sourceLabel ?? 'another application'}]\n${selectionContext.text}`
      : instruction
    clearPrompt()
    showNotice('')
    setHistoryOpen(false)
    setPermissionOpen(false)
    streamedMessage = undefined
    streaming = ''
    addMessage('user', text)
    setRunning(true)
    try {
      await api.ensureSession()
      await api.sendPrompt({ generation: snapshot.generation, text })
      await api.clearSelectionContext()
      setSelectionContext(null)
    } catch (error) {
      setRunning(false)
      addMessage('error', error instanceof Error ? error.message : String(error))
    }
  }

  async function captureScreenshot() {
    if (running || !snapshot.configured) return
    const result = await api.captureScreenshot({ generation: snapshot.generation, text: promptText(prompt).trim() })
    if (!result.ok) { showNotice(result.message); return }
    preview = result
    el('preview-target').textContent = result.targetDescription + (result.targetStale ? ' · Window changed since capture' : '')
    el('preview-image').src = `data:${result.mimeType};base64,${result.data}`
    el('preview-meta').textContent = `${result.width} × ${result.height} · ${formatBytes(result.bytes)} · not sent yet`
    showSheet(previewSheet)
    await setExpanded(true, true)
  }

  async function resolveScreenshot(confirmed) {
    const current = preview
    if (!current) return
    preview = undefined
    closeSheet()
    const result = await api.resolveScreenshot({ generation: snapshot.generation, observationId: current.observationId, confirmed })
    if (!result.sent) { if (confirmed) showNotice(result.message); return }
    clearPrompt()
    addMessage('user', `[screenshot] ${current.targetDescription}`)
    setRunning(true)
  }

  async function exportScreenshot() {
    if (!preview) return
    const result = await api.exportScreenshot({ generation: snapshot.generation, observationId: preview.observationId })
    if (result.ok) showNotice(result.clipboard ? `Saved ${result.path} and copied it to the clipboard.` : `Saved ${result.path}.`)
    else if (!result.canceled) showNotice(result.message)
  }

  async function loadHistory() {
    setHistoryOpen(true)
    historyList.replaceChildren()
    const loading = document.createElement('p')
    loading.className = 'history-empty'
    loading.textContent = 'Loading…'
    historyList.append(loading)
    const result = await api.listSessionHistory()
    historyList.replaceChildren()
    if (!result.ok) { showNotice(result.message); return }
    if (result.sessions.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'history-empty'
      empty.textContent = 'No saved conversations.'
      historyList.append(empty)
      return
    }
    for (const item of result.sessions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'history-row'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(item.sessionId === snapshot.sessionId))
      button.textContent = item.name || item.firstMessage || 'Untitled conversation'
      const detail = document.createElement('small')
      detail.textContent = `${item.messageCount} messages · ${formatHistoryDate(item.modified)}`
      button.append(detail)
      button.addEventListener('click', () => { void openHistory(item.sessionId).catch(report) })
      historyList.append(button)
    }
  }

  async function openHistory(sessionId) {
    const result = await api.openSessionHistory(sessionId)
    if (!result.ok) { showNotice(result.message); return }
    clearMessages()
    for (const message of result.messages) addMessage(message.role, message.text)
    setHistoryOpen(false)
    setRunning(false)
    await refreshStatus()
  }

  async function newConversation() {
    if (running || !snapshot.configured) return
    if (preview) { await api.discardScreenshot(); preview = undefined }
    await api.newConversation()
    clearMessages()
    clearPrompt()
    setHistoryOpen(false)
    setPermissionOpen(false)
    closeSheet()
    await refreshStatus()
  }

  function renderWindowChoices(windows) {
    const list = el('target-list')
    list.replaceChildren()
    list.hidden = false
    for (const choice of windows) {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(choice.windowId === desktopTask.target?.windowId))
      button.textContent = choice.title || choice.appName
      const detail = document.createElement('small')
      detail.textContent = choice.appName
      button.append(detail)
      button.addEventListener('click', async () => {
        const result = await api.setDesktopTarget(choice.windowId)
        if (!result.ok) { showNotice(result.message); return }
        desktopTask = await api.getDesktopTaskStatus()
        renderPermission()
        list.hidden = true
      })
      list.append(button)
    }
  }

  api.onSessionEvent((event) => {
    if (event.type === 'assistant-delta') {
      streaming += event.text
      appendAssistant(streaming)
    } else if (event.type === 'assistant-message') {
      appendAssistant(event.text)
    } else if (event.type === 'error') {
      showNotice(event.message)
      setRunning(false)
    } else if (event.type === 'idle') {
      setRunning(false)
      void refreshStatus().catch(report)
    } else if (event.type === 'session') {
      snapshot = { ...snapshot, sessionId: event.sessionId, generation: event.generation }
    }
  })
  api.onSelectionContext(setSelectionContext)
  api.onDoubleAltGesture(() => { void captureScreenshot().catch(report) })
  setSelectionContext(selectionContext)
  renderPermission()
  syncEmpty()
  setRunning(running)

  document.body.addEventListener('pointerenter', () => {
    dockPointerInside = true
    if (dragging || collapsing) return
    if (docked !== undefined) {
      if (dockHoverArmed) void unsnapDocked().catch(report)
      return
    }
    if (suppressExpand) return
    void setExpanded(true).catch(report)
  })
  document.body.addEventListener('pointerleave', () => {
    dockPointerInside = false
    suppressExpand = false
    if (dragging || collapsing) return
    scheduleCollapse()
  })

  function isPrimaryButton(event) { return event.button === 0 }
  function primaryButtonHeld(event) { return (event.buttons & 1) === 1 }

  ball.addEventListener('pointerdown', event => {
    if (!isPrimaryButton(event)) return
    dragging = false
    collapsing = false
    skipClick = false
    lastOrigin = undefined
    pointer = { ...ballGrabOffset(event), startX: event.screenX, startY: event.screenY }
    ball.setPointerCapture(event.pointerId)
  })
  ball.addEventListener('pointermove', event => {
    if (pointer === undefined) return
    if (!primaryButtonHeld(event)) {
      void finishPointer(event).catch(report)
      return
    }
    lastOrigin = { x: event.screenX - pointer.dx, y: event.screenY - pointer.dy }
    if (!dragging) {
      if (Math.hypot(event.screenX - pointer.startX, event.screenY - pointer.startY) <= 4) return
      dragging = true
      if (running) {
        void moveBall(lastOrigin.x, lastOrigin.y).catch(report)
        return
      }
      collapsing = true
      pinned = false
      document.body.classList.remove('pinned')
      void setExpanded(false, true).then(() => {
        collapsing = false
        if (dragging && lastOrigin !== undefined) void moveBall(lastOrigin.x, lastOrigin.y).catch(report)
      }).catch(report)
      return
    }
    if (!collapsing) void moveBall(lastOrigin.x, lastOrigin.y).catch(report)
  })
  async function finishPointer(event) {
    if (dragging) {
      skipClick = true
      dragging = false
      collapsing = false
      const origin = pointer === undefined
        ? lastOrigin
        : { x: event.screenX - pointer.dx, y: event.screenY - pointer.dy }
      pointer = undefined
      lastOrigin = undefined
      const skipDock = skipDockCommit
      skipDockCommit = false
      if (!skipDock) {
        if (origin !== undefined) await moveBall(origin.x, origin.y)
        await clampBall()
      }
      return true
    }
    pointer = undefined
    lastOrigin = undefined
    return false
  }
  ball.addEventListener('pointerup', async event => {
    if (!isPrimaryButton(event)) {
      await finishPointer(event)
      return
    }
    const dragged = await finishPointer(event)
    if (dragged || skipClick) {
      skipClick = false
      return
    }
    pinned = !pinned
    document.body.classList.toggle('pinned', pinned)
    if (pinned) await setExpanded(true)
    else scheduleCollapse()
  })
  ball.addEventListener('pointercancel', event => { void finishPointer(event).catch(report) })
  ball.addEventListener('lostpointercapture', event => { void finishPointer(event).catch(report) })

  dockTab.addEventListener('pointerdown', event => {
    if (!isPrimaryButton(event)) return
    dragging = false
    collapsing = false
    skipClick = true
    lastOrigin = undefined
    pointer = { dx: 0, dy: 0, startX: event.screenX, startY: event.screenY }
    dockTab.setPointerCapture(event.pointerId)
  })
  dockTab.addEventListener('pointermove', event => {
    if (pointer === undefined || docked === undefined) return
    if (!primaryButtonHeld(event)) {
      void finishPointer(event).catch(report)
      return
    }
    lastOrigin = { x: event.screenX, y: event.screenY }
    const inward = docked === 'right'
      ? pointer.startX - event.screenX
      : event.screenX - pointer.startX
    if (inward <= DOCK_DRAG_OFF_PX) return
    dragging = true
    void unsnapDocked().catch(report)
  })
  dockTab.addEventListener('pointerup', event => { void finishPointer(event).catch(report) })
  dockTab.addEventListener('pointercancel', event => { void finishPointer(event).catch(report) })
  dockTab.addEventListener('lostpointercapture', event => { void finishPointer(event).catch(report) })

  composer.addEventListener('submit', event => {
    event.preventDefault()
    void sendPrompt().catch(report)
  })
  prompt.addEventListener('input', syncComposerHeight)
  prompt.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    if (typeof composer.requestSubmit === 'function') composer.requestSubmit()
    else composer.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  prompt.addEventListener('paste', event => {
    event.preventDefault()
    insertPlainText(prompt, event.clipboardData?.getData('text/plain') ?? '')
    syncComposerHeight()
  })
  composer.addEventListener('click', event => { if (event.target === composer) prompt.focus() })
  stop.addEventListener('click', () => { void api.abort({ generation: snapshot.generation }).catch(report) })

  historyButton.addEventListener('click', () => {
    if (historyOpen) setHistoryOpen(false)
    else void loadHistory().catch(report)
  })
  newConversationButton.addEventListener('click', () => { void newConversation().catch(report) })
  permissionButton.addEventListener('click', event => {
    event.stopPropagation()
    setPermissionOpen(!permissionOpen)
  })
  document.addEventListener('pointerdown', event => {
    if (!permissionRoot.contains(event.target)) setPermissionOpen(false)
  })
  selectionChipDismiss.addEventListener('click', () => {
    void api.clearSelectionContext().catch(report)
    setSelectionContext(null)
  })
  el('choose-workspace').addEventListener('click', () => { void chooseWorkspace().catch(report) })
  el('access-open').addEventListener('click', () => {
    el('shortcut-section').hidden = true
    showSheet(accessSheet)
  })
  el('shortcut-open').addEventListener('click', () => {
    el('shortcut-section').hidden = false
    el('shortcut-input').placeholder = snapshot.shortcut
    showSheet(accessSheet)
  })
  el('capture-context').addEventListener('click', () => { void captureScreenshot().catch(report) })
  el('access-close').addEventListener('click', closeSheet)
  el('target-open').addEventListener('click', async () => {
    const result = await api.listDesktopWindows()
    if (!result.ok) { showNotice(result.message); return }
    renderWindowChoices(result.windows)
  })
  el('authorize-form').addEventListener('submit', async event => {
    event.preventDefault()
    const scope = el('task-scope').value.trim()
    if (!scope) return
    desktopTask = await api.authorizeDesktopTask({ generation: snapshot.generation, scope })
    renderPermission()
    showNotice(desktopTask.authorized ? 'Desktop task approved.' : desktopTask.stoppedReason)
  })
  el('revoke').addEventListener('click', async () => {
    desktopTask = await api.revokeDesktopTask()
    renderPermission()
    showNotice('Desktop authorization revoked.')
  })
  el('shortcut-form').addEventListener('submit', async event => {
    event.preventDefault()
    const value = el('shortcut-input').value.trim()
    if (!value) return
    snapshot = await api.setShortcut(value)
    el('shortcut-input').value = ''
    showNotice(snapshot.shortcutRegistered ? `Wake shortcut set to ${snapshot.shortcut}.` : snapshot.shortcutProblem)
  })
  el('preview-close').addEventListener('click', () => { void resolveScreenshot(false).catch(report) })
  el('preview-discard').addEventListener('click', () => { void resolveScreenshot(false).catch(report) })
  el('preview-send').addEventListener('click', () => { void resolveScreenshot(true).catch(report) })
  el('preview-save').addEventListener('click', () => { void exportScreenshot().catch(report) })
  el('model-close').addEventListener('click', closeSheet)
  panel.addEventListener('contextmenu', event => {
    event.preventDefault()
    const editable = editableTarget(event.target)
    const enabled = (command) => typeof document.queryCommandEnabled === 'function' && document.queryCommandEnabled(command)
    void api.openShellMenu({
      isEditable: editable,
      canCut: editable && enabled('cut'),
      canCopy: enabled('copy'),
      canPaste: editable && enabled('paste'),
      canSelectAll: enabled('selectAll'),
    }).catch(report)
  })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (preview) void resolveScreenshot(false).catch(report)
    else { closeSheet(); setHistoryOpen(false); setPermissionOpen(false) }
  })
}

void main().catch(error => {
  const status = document.getElementById('status')
  if (status) status.textContent = error instanceof Error ? error.message : String(error)
})
