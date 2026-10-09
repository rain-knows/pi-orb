/** Updated sections ported from mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e, packages/helper/assets/shell.js (MIT). Pi IPC/events replace dsh helper transport. */
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
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

function parseRecommendedLabel(label) {
  return RECOMMENDED_SUFFIX.test(label)
    ? { label: label.replace(RECOMMENDED_SUFFIX, ''), recommended: true }
    : { label, recommended: false }
}

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
  const ballGif = el('ball-gif')
  const dockTab = el('dock-tab')
  const transcript = el('transcript')
  const questionRoot = el('question')
  const questionTitle = el('question-title')
  const questionDetail = el('question-detail')
  const questionOptions = el('question-options')
  const questionCustom = el('question-custom')
  const questionError = el('question-error')
  const questionContinue = el('question-continue')
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
  const previewSheet = el('preview-sheet')
  const modelSheet = el('model-sheet')
  const shortcutSheet = el('shortcut-sheet')
  const workspaceGate = el('workspace-gate')
  const transcriptEmpty = el('transcript-empty')
  const newConversationButton = el('new-conversation')
  const ballGifSource = ballGif.getAttribute('src')
  let snapshot = await api.getStatus()
  let desktopTask = snapshot.desktopTask
  let selectionContext = await api.getSelectionContext()
  let preview
  let running = snapshot.busy
  let expanded = false
  let pinned = false
  let dragging = false
  let skipClick = false
  let docked
  let dockHoverArmed = true
  let dockHoverTimer
  let dockPointerInside = false
  let suppressExpand = false
  let skipDockCommit = false
  let pointerHeld = false
  let pointerPointerId
  let pressAt = { x: 0, y: 0 }
  let agentItems = []
  let agentClock
  const agentStrip = el("agent-strip")
  let collapseTimer
  let collapseFrame
  let historyOpen = false
  let permissionOpen = false
  let activeSheet
  let streaming = ''
  let streamedMessage
  let messageCount = 0
  let noticeTimer
  let pendingQuestion
  let openModelChooser
  const toolRows = new Map()

  document.documentElement.lang = 'zh-CN'
  el('input-label').textContent = '消息'
  prompt.dataset.placeholder = '输入消息'
  prompt.classList.add('prompt-empty')
  stop.setAttribute('aria-label', '停止回复')
  newConversationButton.setAttribute('aria-label', '新建对话')
  historyButton.setAttribute('aria-label', '会话历史')
  selectionChipDismiss.setAttribute('aria-label', '移除选中文本')
  selectionChipDismiss.textContent = '\u00d7'
  el('question-cancel').textContent = '取消'
  el('question-skip').hidden = true
  el('question-continue').textContent = '继续'
  el('question-pager').hidden = true
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
    toolRows.clear()
    messageCount = 0
    syncEmpty()
  }

  function syncThinkPreview(node) {
    const summary = node.querySelector('.think-summary-text')?.textContent ?? ''
    node.toggleAttribute('data-preview', !node.hasAttribute('data-expanded') && summary !== '')
  }

  function createThink(node, options = {}) {
    const iconMarkup = options.iconMarkup ?? '<path d="M8 1l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="none" stroke="currentColor"/>'
    node.dataset.variant = 'think'
    const status = document.createElement('span')
    status.className = 'visually-hidden'
    const disclosure = document.createElement('div')
    disclosure.className = 'think-disclosure'
    const row = document.createElement('div')
    row.className = 'think-row'
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.setAttribute('aria-expanded', 'false')
    const leading = document.createElement('span')
    leading.className = 'think-leading'
    const idle = document.createElement('span')
    idle.className = 'think-icon-idle'
    idle.append(noticeIcon(iconMarkup))
    const hover = document.createElement('span')
    hover.className = 'think-chevron-hover'
    hover.append(noticeIcon('<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor"/>'))
    const openChevron = document.createElement('span')
    openChevron.className = 'think-chevron-open'
    openChevron.append(noticeIcon('<path d="M4 10l4-4 4 4" fill="none" stroke="currentColor"/>'))
    leading.append(idle, hover, openChevron)
    const title = document.createElement('span')
    title.className = 'think-title'
    title.textContent = options.title ?? '后台任务报告'
    const separator = document.createElement('span')
    separator.className = 'think-separator'
    separator.setAttribute('aria-hidden', 'true')
    const summary = document.createElement('span')
    summary.className = 'think-summary'
    const summaryText = document.createElement('span')
    summaryText.className = 'think-summary-text'
    summary.append(summaryText)
    row.append(leading, title, separator, summary)
    const body = document.createElement('div')
    body.className = 'think-body'
    disclosure.append(row, body)
    node.append(status, disclosure)
    // A notice card ships settled: its one-line summary and body are filled here.
    if (options.summary !== undefined) {
      summaryText.textContent = options.summary
      node.dataset.preview = 'true'
    }
    if (options.body !== undefined) body.textContent = options.body
    const toggle = () => {
      const open = !node.hasAttribute('data-expanded')
      node.toggleAttribute('data-expanded', open)
      disclosure.toggleAttribute('data-open', open)
      row.setAttribute('aria-expanded', String(open))
      syncThinkPreview(node)
    }
    row.addEventListener('click', toggle)
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggle()
    })
  }

  function noticeIcon(markup) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML = markup
    return svg
  }
  function isCompletionNotice(text) {
    return text.startsWith('Background Code agent session ') || text.startsWith('The user stopped background Code agent session ')
  }
  function addCodeAgentNotice(text) {
    if (!isCompletionNotice(text)) return
    const guard = 'Do not restart this task and do not call code_agent for it again unless the user asks.'
    const shown = text.endsWith(guard) ? text.slice(0, -guard.length).trimEnd() : text
    const node = document.createElement('article')
    node.className = 'block'
    node.dataset.kind = 'notice'
    createThink(node, { summary: shown.split('\n').find(line => line.trim() !== '') ?? '', body: shown })
    transcript.append(node)
    messageCount += 1
    syncEmpty()
    transcript.scrollTop = transcript.scrollHeight
  }
  function addMessage(role, text) {
    if (role === "user" && isCompletionNotice(text)) { addCodeAgentNotice(text); return }
    const article = document.createElement('article')
    article.className = `orb-message orb-message--${role}`
    const label = document.createElement('strong')
    label.textContent = role === 'user' ? '你' : role === 'error' ? '错误' : 'Orb'
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
    syncBallGif()
    if (!next) {
      streaming = ''
      streamedMessage = undefined
      closeQuestion()
    }
  }

  function freezeBallGif() {
    const still = () => {
      if (ballGif.dataset.mode !== 'still' || ballGif.naturalWidth === 0) return
      const canvas = document.createElement('canvas')
      canvas.width = ballGif.naturalWidth
      canvas.height = ballGif.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) return
      context.drawImage(ballGif, 0, 0)
      try {
        ballGif.src = canvas.toDataURL()
      } catch {
        // The GIF remains at its first frame when the canvas is unavailable.
      }
    }
    if (ballGif.complete && ballGif.naturalWidth > 0) still()
    else ballGif.addEventListener('load', still, { once: true })
  }

  function syncBallGif() {
    const shouldPlay = expanded || running || Boolean(pendingQuestion) || hasSelectionChip()
    if (shouldPlay) {
      if (ballGif.dataset.mode !== 'play') {
        ballGif.dataset.mode = 'play'
        ballGif.src = ballGifSource
      }
      return
    }
    if (ballGif.dataset.mode === 'still') return
    ballGif.dataset.mode = 'still'
    ballGif.src = ballGifSource
    freezeBallGif()
  }

  function applyDirection(state) {
    document.body.classList.toggle('expand-left', state.horizontal === 'left')
    document.body.classList.toggle('expand-right', state.horizontal === 'right')
    document.body.classList.toggle('expand-up', state.vertical === 'up')
    document.body.classList.toggle('expand-down', state.vertical === 'down')
    const strip = typeof state.strip === 'number' && Number.isFinite(state.strip) ? Math.max(0, Math.round(state.strip)) : 0
    document.body.classList.toggle('has-strip', strip > 0)
    document.body.classList.toggle('strip-left', strip > 0 && state.horizontal === 'left')
    document.body.classList.toggle('strip-right', strip > 0 && state.horizontal === 'right')
    document.body.style.setProperty('--strip-w', strip + 'px')
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
    if (result.expanded === true) applyDirection(result)
    applyDocked(result.docked)
  }

  /**
   * Press on `element`: keep the client point the drag threshold and the dock tab's
   * pull are measured from (both while the window is still static), and capture the
   * pointer so the gesture survives the window moving out from under the cursor.
   */
  function beginPointer(element, event) {
    pressAt = { x: event.clientX, y: event.clientY }
    pointerPointerId = event.pointerId
    pointerHeld = true
    element.setPointerCapture(event.pointerId)
  }

  function ownsPointer(event) {
    if (pointerPointerId === undefined) return false
    return event.pointerId === undefined || event.pointerId === pointerPointerId
  }

  // A gesture that ends outside the window (or while the compositor holds the
  // capture) must never leave the panel locked shut.
  window.addEventListener('blur', () => {
    if (pointerHeld) void finishGesture()
  })

  /**
   * The gesture is over. A drag is committed by the main process, which places the
   * ball under the OS cursor and decides the dock. A press without a drag is left to
   * the click handler, so this returns false.
   */
  async function finishGesture() {
    const moved = dragging
    pointerHeld = false
    pointerPointerId = undefined
    dragging = false
    if (!moved) {
      // Clear the main-process grab as well: blur/cancel must not leave an old press behind.
      await api.dragEnd(!(running || Boolean(pendingQuestion)))
      return false
    }
    skipClick = true
    const skipDock = skipDockCommit
    skipDockCommit = false
    if (!skipDock) applyDockedFrom(await api.dragEnd(!(running || Boolean(pendingQuestion))))
    return true
  }

  /**
   * The ball gesture passed the motion threshold. A free panel collapses first: its
   * DOM now, its window in the main process, before any move signal goes out. A
   * running or asking agent keeps the panel open and the ball simply follows.
   */
  function startBallDrag() {
    dragging = true
    if (!(running || Boolean(pendingQuestion))) {
      pinned = false
      document.body.classList.remove('pinned')
      void setExpanded(false, true)
    }
    api.dragBegin()
  }

  function syncExpand() {
    if (pointerHeld || dragging) return
    if (docked !== undefined) {
      if (dockHoverArmed) void unsnapDocked()
      return
    }
    if (suppressExpand) return
    void setExpanded(true)
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
      renderAgentStrip()
      syncBallGif()
      stop.hidden = !running
      return
    }
    if (!force && (pinned || running || pendingQuestion || hasSelectionChip() || activeSheet || historyOpen || hasDraft() || isEditing())) return
    expanded = false
    document.body.classList.remove('expanded')
    renderAgentStrip()
    syncBallGif()
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

  function hasSelectionChip() { return selectionContext !== null && selectionContext !== undefined }
  function hasDraft() { return promptText(prompt).trim().length > 0 }
  function isEditing() { return document.activeElement === prompt || document.activeElement === questionCustom || document.activeElement === el('shortcut-input') }

  function scheduleCollapse() {
    if (pinned || running || dragging || pendingQuestion || hasSelectionChip() || activeSheet || historyOpen || hasDraft() || isEditing()) return
    if (collapseTimer !== undefined) clearTimeout(collapseTimer)
    collapseTimer = setTimeout(() => {
      collapseTimer = undefined
      void setExpanded(false)
    }, COLLAPSE_MS)
  }

  function agentStateText(state) {
    if (state === 'completed') return '已完成'
    if (state === 'stopped') return '已停止'
    if (state === 'ended') return '已结束'
    return '运行中'
  }

  function agentDurationText(totalMs) {
    const minutes = Math.floor(Math.max(0, totalMs) / 60_000)
    if (minutes < 1) return '<1m'
    if (minutes < 100) return `${minutes}m`
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
  }

  function agentElapsedText(item) {
    const start = typeof item.startedAt === 'number' ? item.startedAt : 0
    const end = item.state === 'running'
      ? Date.now()
      : (typeof item.endedAt === 'number' ? item.endedAt : Date.now())
    return agentDurationText(end - start)
  }

  function agentTip(item) {
    const parts = [`${agentStateText(item.state)} · ${agentElapsedText(item)}`]
    if (typeof item.task === 'string' && item.task !== '') parts.push(item.task)
    if (typeof item.callerTitle === 'string' && item.callerTitle !== '') parts.push(`${'来自对话'}: ${item.callerTitle}`)
    if (typeof item.cwd === 'string' && item.cwd !== '') parts.push(`${'工作目录'}: ${item.cwd}`)
    if (typeof item.outcome === 'string' && item.outcome !== '') parts.push(item.outcome)
    parts.push('点击在主窗口打开')
    return parts.join('\n')
  }

  function agentChip(item) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'agent-chip'
    chip.dataset.state = typeof item.state === 'string' ? item.state : 'running'
    const color = Number(item.colorIndex)
    chip.style.setProperty('--agent-color', `var(--agent-c${Number.isFinite(color) ? Math.abs(color) % 4 : 0})`)
    chip.setAttribute('role', 'listitem')
    const status = document.createElement('span')
    status.className = 'agent-chip-status'
    if (item.state === 'completed') {
      status.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8l3 3 7-7" fill="none" stroke="currentColor"/></svg>`
    } else if (item.state === 'stopped') {
      status.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="4" y="4" width="8" height="8" fill="currentColor"/></svg>`
    } else if (item.state === 'ended') {
      status.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2L15 14H1Z" fill="none" stroke="currentColor"/></svg>`
    } else {
      const spinner = document.createElement('span')
      spinner.className = 'agent-spinner'
      status.append(spinner)
    }
    const time = document.createElement('span')
    time.className = 'agent-chip-time'
    time.dataset.state = chip.dataset.state
    time.dataset.startedAt = String(item.startedAt ?? '')
    time.dataset.endedAt = String(item.endedAt ?? '')
    time.textContent = agentElapsedText(item)
    const name = document.createElement('span')
    name.className = 'agent-chip-name'
    name.textContent = typeof item.task === 'string' ? item.task : ''
    chip.append(status, time, name)
    if (item.unread === true) {
      const dot = document.createElement('span')
      dot.className = 'agent-chip-unread'
      chip.append(dot)
    }
    chip.title = agentTip(item)
    chip.setAttribute('aria-label', `${agentStateText(item.state)}: ${name.textContent}`)
    chip.addEventListener('click', () => {
      if (typeof item.sessionId === 'string') void api.openAgent(item.sessionId).then(refreshAgents).catch(report)
    })
    return chip
  }

  function renderAgentStrip() {
    if (agentStrip === null) return
    agentStrip.replaceChildren()
    const visible = expanded && agentItems.length > 0
    agentStrip.hidden = !visible
    if (!visible) {
      stopAgentClock()
      return
    }
    for (const item of agentItems) agentStrip.append(agentChip(item))
    startAgentClock()
  }

  function startAgentClock() {
    stopAgentClock()
    agentClock = window.setInterval(refreshAgentTimes, 1000)
  }

  function stopAgentClock() {
    if (agentClock === undefined) return
    window.clearInterval(agentClock)
    agentClock = undefined
  }

  function refreshAgentTimes() {
    if (agentStrip === null) return
    for (const time of agentStrip.querySelectorAll('.agent-chip-time')) {
      const start = Number(time.dataset.startedAt)
      const endedAt = Number(time.dataset.endedAt)
      const end = time.dataset.state === 'running' || !Number.isFinite(endedAt) || endedAt <= 0
        ? Date.now()
        : endedAt
      time.textContent = agentDurationText(end - (Number.isFinite(start) ? start : 0))
    }
  }

  function sortAgentItems(items) {
    items.sort((left, right) => {
      const leftRunning = left.state === 'running'
      const rightRunning = right.state === 'running'
      if (leftRunning !== rightRunning) return leftRunning ? -1 : 1
      if (leftRunning) return (left.startedAt ?? 0) - (right.startedAt ?? 0)
      return (right.endedAt ?? 0) - (left.endedAt ?? 0)
    })
    return items
  }

  async function refreshAgents() {
    agentItems = sortAgentItems(await api.getAgentBookmarks())
    renderAgentStrip()
  }
  api.onFloatingState(applyDirection)
  const agentPoll = window.setInterval(() => { void refreshAgents().catch(report) }, 1000)
  window.addEventListener('beforeunload', () => { window.clearInterval(agentPoll); stopAgentClock() })
  void refreshAgents().catch(report)

  function setHistoryOpen(next) {
    historyOpen = next
    historyButton.setAttribute('aria-pressed', String(next))
    historyList.hidden = !next
    transcript.hidden = next
    questionRoot.hidden = next || !pendingQuestion
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
    for (const sheet of [previewSheet, modelSheet, shortcutSheet]) sheet.hidden = true
  }

  function closeQuestion(id) {
    if (id !== undefined && pendingQuestion?.id !== id) return
    pendingQuestion = undefined
    questionRoot.hidden = true
    document.body.classList.remove('asking')
    syncBallGif()
  }

  function renderQuestion() {
    const pending = pendingQuestion
    if (!pending) return
    document.body.classList.add('asking')
    syncBallGif()
    questionRoot.hidden = false
    el('question-eyebrow').hidden = true
    questionTitle.textContent = pending.title
    questionDetail.textContent = pending.message
    questionDetail.hidden = !pending.message
    questionOptions.replaceChildren()
    const choices = pending.method === 'confirm' ? ['是', '否'] : pending.options
    questionOptions.setAttribute('role', 'radiogroup')
    for (const [index, option] of choices.entries()) {
      const display = parseRecommendedLabel(option)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = pending.selected === option ? 'question-option selected' : 'question-option'
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(pending.selected === option))
      button.disabled = pending.busy
      const mark = document.createElement('span')
      mark.className = 'question-option-mark'
      mark.textContent = String(index + 1)
      const copy = document.createElement('span')
      copy.className = 'question-option-copy'
      const label = document.createElement('span')
      label.className = 'question-option-label'
      label.textContent = display.label
      copy.append(label)
      if (display.recommended) {
        const badge = document.createElement('span')
        badge.className = 'question-recommended'
        badge.textContent = '推荐'
        copy.append(badge)
      }
      button.append(mark, copy)
      button.addEventListener('click', () => {
        if (pending.busy) return
        pending.selected = option
        renderQuestion()
      })
      questionOptions.append(button)
    }
    questionCustom.hidden = pending.method !== 'input' && pending.method !== 'editor'
    if (!questionCustom.hidden) {
      questionCustom.value = pending.value
      questionCustom.placeholder = pending.method === 'input' ? '输入回答' : '填写回答'
      questionCustom.rows = pending.method === 'editor' ? 4 : 1
    }
    questionError.hidden = !pending.error
    questionError.textContent = pending.error ?? ''
    questionContinue.textContent = pending.method === 'confirm' ? '确认' : '继续'
    questionContinue.disabled = pending.busy || (questionCustom.hidden ? pending.selected === undefined : pending.value.trim() === '')
    el('question-cancel').disabled = pending.busy
  }

  async function answerQuestion(cancelled = false) {
    const pending = pendingQuestion
    if (!pending || pending.busy) return
    let answer
    if (cancelled) answer = { generation: snapshot.generation, id: pending.id, cancelled: true }
    else if (pending.method === 'confirm' && pending.selected !== undefined) {
      answer = { generation: snapshot.generation, id: pending.id, confirmed: pending.selected === '是' }
    } else if ((pending.method === 'input' || pending.method === 'editor') && pending.value.trim()) {
      answer = { generation: snapshot.generation, id: pending.id, value: pending.value }
    } else if (pending.method === 'select' && pending.selected !== undefined) {
      answer = { generation: snapshot.generation, id: pending.id, value: pending.selected }
    } else {
      pending.error = '请选择或填写回答。'
      renderQuestion()
      return
    }
    pending.busy = true
    renderQuestion()
    try {
      await api.respondQuestion(answer)
      closeQuestion(pending.id)
    } catch (error) {
      pending.busy = false
      pending.error = error instanceof Error ? error.message : String(error)
      renderQuestion()
    }
  }

  function showSheet(sheet) {
    setHistoryOpen(false)
    setPermissionOpen(false)
    closeSheet()
    activeSheet = sheet
    sheet.hidden = false
  }

  function renderPermission() {
    const labels = { 'read-only': '只读', 'workspace-write': '工作区写入', 'full-access': '完全访问' }
    permissionLabel.textContent = desktopTask.level ? labels[desktopTask.level] : '访问权限'
    for (const option of permissionMenu.querySelectorAll('[data-level]')) {
      option.setAttribute('aria-selected', String(option.dataset.level === desktopTask.level))
    }
  }

  function setSelectionContext(context) {
    selectionContext = context
    selectionChip.hidden = !context
    document.body.classList.toggle('has-selection-chip', Boolean(context))
    const summary = context?.text.replace(/\s+/g, ' ').trim() ?? ''
    selectionChipText.textContent = context ? `${context.sourceLabel ?? '其他应用'} · ${summary.length > 72 ? `${summary.slice(0, 69)}...` : summary}` : ''
    selectionChip.title = context?.text ?? ''
    syncBallGif()
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
    const previousGeneration = snapshot.generation
    snapshot = await api.setWorkspace(picked.resolved ?? '', false)
    if (snapshot.generation !== previousGeneration) {
      closeSheet()
      preview = undefined
      setHistoryOpen(false)
      historyList.replaceChildren()
      clearMessages()
      clearPrompt()
      setSelectionContext(null)
      setRunning(false)
    }
    desktopTask = snapshot.desktopTask
    renderPermission()
    syncEmpty()
    if (snapshot.problem) showNotice(snapshot.problem)
  }

  async function sendPrompt() {
    const instruction = promptText(prompt).trim()
    if ((!instruction && !selectionContext) || !snapshot.configured) return
    const text = selectionContext
      ? `${instruction || '请帮我理解这段选中的文本。'}\n\n[选自 ${selectionContext.sourceLabel ?? '其他应用'}]\n${selectionContext.text}`
      : instruction
    clearPrompt()
    showNotice('')
    setHistoryOpen(false)
    setPermissionOpen(false)
    if (!running) {
      streamedMessage = undefined
      streaming = ''
    }
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
    el('preview-target').textContent = result.targetDescription + (result.targetStale ? ' · 截图后窗口已变化' : '')
    el('preview-image').src = `data:${result.mimeType};base64,${result.data}`
    el('preview-meta').textContent = `${result.width} × ${result.height} · ${formatBytes(result.bytes)} · 尚未发送`
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
    if (result.ok) showNotice(result.clipboard ? `已保存 ${result.path}，并复制到剪贴板。` : `已保存 ${result.path}。`)
    else if (!result.canceled) showNotice(result.message)
  }

  async function loadHistory() {
    setHistoryOpen(true)
    historyList.replaceChildren()
    const loading = document.createElement('p')
    loading.className = 'history-empty'
    loading.textContent = '加载中…'
    historyList.append(loading)
    const result = await api.listSessionHistory()
    historyList.replaceChildren()
    if (!result.ok) { showNotice(result.message); return }
    if (result.sessions.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'history-empty'
      empty.textContent = '暂无历史会话。'
      historyList.append(empty)
      return
    }
    for (const item of result.sessions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'history-row'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(item.sessionId === snapshot.sessionId))
      button.textContent = item.name || item.firstMessage || '未命名会话'
      const detail = document.createElement('small')
      detail.textContent = `${item.messageCount} 条消息 · ${formatHistoryDate(item.modified)}`
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
    toolRows.clear()
    closeQuestion()
    clearPrompt()
    setHistoryOpen(false)
    setPermissionOpen(false)
    closeSheet()
    await refreshStatus()
  }

  api.onSessionEvent((event) => {
    if (event.type === 'code-agent-notice') {
      addCodeAgentNotice(event.text)
    } else if (event.type === 'access') {
      desktopTask = event.status
      renderPermission()
    } else if (event.type === 'assistant-delta') {
      streaming += event.text
      appendAssistant(streaming)
    } else if (event.type === 'assistant-message') {
      appendAssistant(event.text)
    } else if (event.type === 'error') {
      showNotice(event.message)
    } else if (event.type === 'idle') {
      setRunning(false)
      void refreshStatus().catch(report)
    } else if (event.type === 'turn-start') {
      streamedMessage = undefined
      streaming = ''
      setRunning(true)
    } else if (event.type === 'queued') {
      showNotice(`${event.count} 条消息已排队`)
    } else if (event.type === 'session') {
      snapshot = { ...snapshot, sessionId: event.sessionId, generation: event.generation }
    } else if (event.type === 'tool') {
      let row = toolRows.get(event.id)
      if (!row) {
        row = document.createElement('div')
        row.className = 'orb-tool'
        const marker = document.createElement('span')
        marker.className = 'orb-tool-marker'
        marker.setAttribute('aria-hidden', 'true')
        const name = document.createElement('strong')
        name.textContent = ({
          read: '读取文件', write: '写入文件', edit: '编辑文件', bash: '执行命令',
          click: '点击', input_text: '输入文字', scroll: '滚动', hotkey: '按键', long_press: '长按', drag: '拖动',
          open_app: '打开应用', list_apps: '查看应用', wait: '等待', long_wait: '等待任务', screenshot: '截图',
          open_in_browser: '打开浏览器', open_in_finder: '打开文件',
        })[event.name] ?? event.name
        const phase = document.createElement('span')
        phase.className = 'orb-tool-phase'
        const detail = document.createElement('p')
        row.append(marker, name, phase, detail)
        transcript.append(row)
        toolRows.set(event.id, row)
      }
      row.classList.toggle('orb-tool--running', event.phase !== 'end')
      row.classList.toggle('orb-tool--error', event.isError)
      row.querySelector('.orb-tool-phase').textContent = event.phase !== 'end' ? '进行中' : event.isError ? '失败' : '完成'
      row.querySelector('p').textContent = event.phase !== 'end'
        ? (event.detail && event.detail !== 'Running' ? event.detail : '正在执行…')
        : event.isError ? (event.detail && event.detail !== 'Failed' ? event.detail : '调用失败') : ''
      transcript.scrollTop = transcript.scrollHeight
      if (event.phase === 'end' && Number.isFinite(event.extensionReturnedAt)) {
        window.requestAnimationFrame(() => {
          const durationMs = window.performance.timeOrigin + window.performance.now() - event.extensionReturnedAt
          if (durationMs >= 0) console.log('[pi-orb] extension-return-to-render (Pi image processing + event transport + render)', { requestId: event.requestId, durationMs })
        })
      }
    } else if (event.type === 'question') {
      pendingQuestion = { ...event, selected: undefined, value: event.prefill, error: undefined, busy: false }
      setHistoryOpen(false)
      setPermissionOpen(false)
      closeSheet()
      renderQuestion()
      void setExpanded(true).catch(report)
    } else if (event.type === 'question-closed') {
      closeQuestion(event.id)
    }
  })
  api.onSelectionContext(setSelectionContext)
  api.onDoubleAltGesture(() => { void captureScreenshot().catch(report) })
  setSelectionContext(selectionContext)
  renderPermission()
  syncEmpty()
  setRunning(running)

  function isPrimaryButton(event) {
    return event.button === 0
  }

  function primaryButtonHeld(event) {
    return (event.buttons & 1) === 1
  }

  document.body.addEventListener('pointerenter', (event) => {
    dockPointerInside = true
    // A dropped pointerup (capture stolen, window hidden mid-gesture) would leave the
    // press flags stuck and the panel permanently unable to expand. Only a reported
    // "no buttons" counts: an absent field must not end a live drag.
    if (pointerHeld && typeof event.buttons === 'number' && event.buttons === 0) void finishGesture()
    syncExpand()
  })
  document.body.addEventListener('pointerleave', () => {
    dockPointerInside = false
    suppressExpand = false
    if (pointerHeld || dragging) return
    scheduleCollapse()
  })

  ball.addEventListener('pointerdown', (event) => {
    if (!isPrimaryButton(event)) return
    dragging = false
    skipClick = false
    beginPointer(ball, event)
    api.dragPress()
  })
  ball.addEventListener('pointermove', (event) => {
    if (!ownsPointer(event)) return
    if (!primaryButtonHeld(event)) {
      void finishGesture()
      return
    }
    if (!dragging) {
      if (Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) <= 4) return
      startBallDrag()
    }
    api.dragMove(!(running || Boolean(pendingQuestion)))
  })
  ball.addEventListener('pointerup', async (event) => {
    if (!isPrimaryButton(event)) {
      void finishGesture()
      return
    }
    const dragged = await finishGesture()
    if (dragged || skipClick) {
      skipClick = false
      return
    }
    pinned = !pinned
    document.body.classList.toggle('pinned', pinned)
    if (pinned) await setExpanded(true)
    else scheduleCollapse()
  })
  ball.addEventListener('pointercancel', () => { void finishGesture() })
  ball.addEventListener('lostpointercapture', () => { void finishGesture() })

  dockTab.addEventListener('pointerdown', (event) => {
    if (!isPrimaryButton(event)) return
    dragging = false
    skipClick = true
    beginPointer(dockTab, event)
  })
  dockTab.addEventListener('pointermove', (event) => {
    if (!ownsPointer(event) || docked === undefined) return
    if (!primaryButtonHeld(event)) {
      void finishGesture()
      return
    }
    const pulled = docked === 'right' ? pressAt.x - event.clientX : event.clientX - pressAt.x
    if (pulled <= DOCK_DRAG_OFF_PX) return
    dragging = true
    void unsnapDocked()
  })
  dockTab.addEventListener('pointerup', () => { void finishGesture() })
  dockTab.addEventListener('pointercancel', () => { void finishGesture() })
  dockTab.addEventListener('lostpointercapture', () => { void finishGesture() })

  composer.addEventListener('submit', event => {
    event.preventDefault()
    void sendPrompt().catch(report)
  })
  /** Input clicks only pin; unpinning stays a ball click (or drag). */
  function pinBall() {
    if (pinned) return
    pinned = true
    document.body.classList.add('pinned')
  }

  prompt.addEventListener('click', pinBall)
  prompt.addEventListener('input', syncComposerHeight)
  prompt.addEventListener('focusout', () => {
    setTimeout(() => { if (!dockPointerInside) scheduleCollapse() }, 0)
  })
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
  composer.addEventListener('click', event => { if (event.target === composer) { prompt.focus(); pinBall() } })
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
  for (const option of permissionMenu.querySelectorAll('[data-level]')) {
    option.addEventListener('click', async () => {
      const level = option.dataset.level
      if (!level) return
      desktopTask = await api.setOrbAccess({ generation: snapshot.generation, level })
      renderPermission()
      setPermissionOpen(false)
    })
  }
  el('preview-close').addEventListener('click', () => { void resolveScreenshot(false).catch(report) })
  el('preview-discard').addEventListener('click', () => { void resolveScreenshot(false).catch(report) })
  el('preview-send').addEventListener('click', () => { void resolveScreenshot(true).catch(report) })
  el('preview-save').addEventListener('click', () => { void exportScreenshot().catch(report) })
  el('model-close').addEventListener('click', closeSheet)
  el('shortcut-close').addEventListener('click', closeSheet)
  el('shortcut-form').addEventListener('submit', async event => {
    event.preventDefault()
    snapshot = await api.setShortcut(el('shortcut-input').value.trim())
    if (!snapshot.shortcutRegistered) {
      showNotice(snapshot.shortcutProblem ?? '快捷键注册失败。')
      return
    }
    showNotice('唤醒快捷键：' + snapshot.shortcut)
    closeSheet()
  })
  function openShortcutEditor() {
    el('shortcut-input').value = snapshot.shortcut
    showSheet(shortcutSheet)
    el('shortcut-input').focus()
    el('shortcut-input').select()
  }
  openModelChooser = async () => {
    showSheet(modelSheet)
    const list = el('model-list')
    list.textContent = '加载中…'
    const result = await api.listModels()
    if (!result.ok) { list.textContent = result.message; return }
    list.replaceChildren()
    if (result.models.length === 0) { list.textContent = '当前工作区没有可用模型。'; return }
    for (const model of result.models) {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(result.selected?.provider === model.provider && result.selected?.id === model.id))
      button.textContent = model.name + ' · ' + model.provider
      button.addEventListener('click', async () => {
        const selected = await api.setModel({ generation: snapshot.generation, provider: model.provider, id: model.id })
        if (!selected.ok) { showNotice(selected.message); return }
        showNotice('模型：' + model.name)
        closeSheet()
      })
      list.append(button)
    }
  }
  api.onShellMenuAction(action => {
    if (action === 'model') void openModelChooser().catch(report)
    else if (action === 'screenshot') void captureScreenshot().catch(report)
    else if (action === 'shortcut') openShortcutEditor()
    else if (action === 'workspace') void chooseWorkspace().catch(report)
  })
  el('question-cancel').addEventListener('click', () => { void answerQuestion(true).catch(report) })
  questionContinue.addEventListener('click', () => { void answerQuestion().catch(report) })
  questionCustom.addEventListener('input', () => {
    if (!pendingQuestion) return
    pendingQuestion.value = questionCustom.value
    pendingQuestion.error = undefined
    questionContinue.disabled = pendingQuestion.value.trim() === ''
    questionError.hidden = true
  })
  questionCustom.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    if (pendingQuestion?.method === 'editor') return
    event.preventDefault()
    void answerQuestion().catch(report)
  })
  document.body.addEventListener('contextmenu', event => {
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
