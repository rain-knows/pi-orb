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

  function addMessage(role, text) {
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
      syncBallGif()
      stop.hidden = !running
      return
    }
    if (!force && (pinned || running || pendingQuestion || hasSelectionChip() || activeSheet || historyOpen || hasDraft() || isEditing())) return
    expanded = false
    document.body.classList.remove('expanded')
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

  function ballGrabOffset(event) {
    const rect = ball.getBoundingClientRect()
    return { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
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
    snapshot = await api.setWorkspace(picked.resolved ?? '', false)
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
    if (event.type === 'assistant-delta') {
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
          orb_batch: '批量操作', orb_observe: '观察桌面', orb_click: '点击', orb_type: '输入文字', orb_scroll: '滚动',
          orb_hotkey: '按键', orb_long_press: '长按', orb_drag: '拖动', orb_open_app: '切换应用',
          orb_list_apps: '查看应用', orb_wait: '等待', orb_long_wait: '等待任务',
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
