function formatFileSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './services/api.js'
import { templateConfig as cfg } from './template.config.js'

const LS_KEYS = {
  usuario: 'logtudo_usuario',
  senha: 'logtudo_senha',
  dataReferencia: 'logtudo_data_referencia',
  tipoOperacao: 'logtudo_tipo_operacao',
  theme: 'automation_theme',
}

const statusMap = {
  PENDING: { label: 'Aguardando', tone: '' },
  STARTED: { label: 'Em execução', tone: 'ok' },
  RUNNING: { label: 'Em execução', tone: 'ok' },
  PAUSED: { label: 'Pausado', tone: 'warn' },
  SUCCESS: { label: 'Concluído', tone: 'ok' },
  COMPLETED: { label: 'Concluído', tone: 'ok' },
  FAILED: { label: 'Falhou', tone: 'bad' },
  FAILURE: { label: 'Falhou', tone: 'bad' },
  CANCELLED: { label: 'Cancelado', tone: 'bad' },
  IDLE: { label: 'Aguardando', tone: '' },
}

function normalizeStatus(st) {
  if (!st) return 'PENDING'
  const u = String(st).toUpperCase()
  if (u === 'STARTED') return 'RUNNING'
  if (u === 'SUCCESS') return 'COMPLETED'
  if (u === 'FAILURE') return 'FAILED'
  return u
}

function formatDateForApi(isoDate) {
  if (!isoDate || !isoDate.includes('-')) return isoDate || ''
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

function formatIsoForDisplay(isoString) {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return isoString
    return d.toLocaleString('pt-BR')
  } catch {
    return isoString
  }
}

export default function App({ initialTab = 'execution' }) {
  const [tab, setTab] = useState(initialTab)
  const [theme, setTheme] = useState(() => localStorage.getItem(LS_KEYS.theme) || 'dark')
  const [toastMessage, setToastMessage] = useState('')

  // Configuração & Credenciais
  const [usuario, setUsuario] = useState(() => localStorage.getItem(LS_KEYS.usuario) || '')
  const [senha, setSenha] = useState(() => localStorage.getItem(LS_KEYS.senha) || '')
  const [showSenha, setShowSenha] = useState(false)
  const [dataReferencia, setDataReferencia] = useState(() => localStorage.getItem(LS_KEYS.dataReferencia) || '')
  const [tipoOperacao, setTipoOperacao] = useState(() => localStorage.getItem(LS_KEYS.tipoOperacao) || 'D2D')

  // Estado do Lote Ativo
  const [selectedFile, setSelectedFile] = useState(null)
  const [validationReport, setValidationReport] = useState(null)
  const [activeJob, setActiveJob] = useState(null)
  const [items, setItems] = useState([])
  const [logs, setLogs] = useState([])
  const [jobsHistory, setJobsHistory] = useState([])
  const [adminSummary, setAdminSummary] = useState(null)

  // Polling ref
  const cursorRef = useRef(0)
  const logContainerRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [isStarting, setIsStarting] = useState(false)

  // Filtros e Detalhes da Tabela e Terminal
  const [logFilter, setLogFilter] = useState('')
  const [logLevel, setLogLevel] = useState('TODOS')
  const [itemSearch, setItemSearch] = useState('')
  const [itemStatusFilter, setItemStatusFilter] = useState('TODOS')
  const [selectedItemDetail, setSelectedItemDetail] = useState(null)
  const [jobArtifacts, setJobArtifacts] = useState([])
  const [previewScreenshotModal, setPreviewScreenshotModal] = useState(null)
  const [historyDetailJob, setHistoryDetailJob] = useState(null)

  const isErrorStatus = (st) => {
    const s = String(st || '').toUpperCase()
    return s.includes('FAIL') || s.includes('ERR') || s.includes('FALHA')
  }

  const isSuccessStatus = (st) => {
    const s = String(st || '').toUpperCase()
    return s.includes('SUCC') || s.includes('COMPL') || s.includes('OK') || s.includes('CONCLU')
  }

  const copyLogs = () => {
    if (!logs.length) return
    const text = logs.map((l) => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n')
    navigator.clipboard?.writeText(text)
    notify('Logs copiados para a área de transferência!')
  }

  const formatItemStatus = (st) => {
    const s = String(st || '').toUpperCase()
    if (s.includes('FAIL') || s.includes('ERRO') || s.includes('FALHA')) return 'Falha na Validação'
    if (s.includes('RUN') || s.includes('EXEC')) return 'Em processamento'
    if (s.includes('SUCC') || s.includes('COMPL')) return 'Sucesso'
    return 'Pendente'
  }

  const selectedItemScreenshotUrl = useMemo(() => {
    if (!selectedItemDetail) return null
    if (selectedItemDetail.screenshot_url) return selectedItemDetail.screenshot_url
    if (selectedItemDetail.screenshot) return selectedItemDetail.screenshot

    const ref = String(selectedItemDetail.reference || selectedItemDetail.numero || '')
    const row = String(selectedItemDetail.row || '')
    const matched = jobArtifacts.find((a) => {
      const name = (a.filename || a.name || '').toLowerCase()
      return (ref && name.includes(ref.toLowerCase())) || (row && name.includes(`row-${row}`))
    }) || jobArtifacts.find((a) => (a.type === 'screenshot' || (a.filename || '').endsWith('.png')))

    if (matched) {
      return api.getArtifactDownloadUrl(matched.id)
    }
    return null
  }, [selectedItemDetail, jobArtifacts])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (itemStatusFilter !== 'TODOS') {
        const norm = (item.status || 'PENDING').toUpperCase()
        if (itemStatusFilter === 'PENDING' && !norm.includes('PEND')) return false
        if (itemStatusFilter === 'SUCCESS' && !norm.includes('SUCC') && !norm.includes('COMPL')) return false
        if (itemStatusFilter === 'FAILED' && !norm.includes('FAIL') && !norm.includes('ERR')) return false
      }
      if (itemSearch) {
        const term = itemSearch.toLowerCase()
        const ref = String(item.reference || item.numero || item.row || '').toLowerCase()
        const nome = String(item.nome || item.nome_motorista || '').toLowerCase()
        const placa = String(item.placa || '').toLowerCase()
        return ref.includes(term) || nome.includes(term) || placa.includes(term)
      }
      return true
    })
  }, [items, itemSearch, itemStatusFilter])

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (logLevel !== 'TODOS' && l.level !== logLevel) return false
      if (logFilter) {
        const term = logFilter.toLowerCase()
        return (l.message || '').toLowerCase().includes(term)
      }
      return true
    })
  }, [logs, logLevel, logFilter])

  // Persistência local de preferências
  useEffect(() => localStorage.setItem(LS_KEYS.usuario, usuario), [usuario])
  useEffect(() => localStorage.setItem(LS_KEYS.senha, senha), [senha])
  useEffect(() => localStorage.setItem(LS_KEYS.dataReferencia, dataReferencia), [dataReferencia])
  useEffect(() => localStorage.setItem(LS_KEYS.tipoOperacao, tipoOperacao), [tipoOperacao])
  useEffect(() => {
    document.documentElement.className = theme
    localStorage.setItem(LS_KEYS.theme, theme)
  }, [theme])

  const notify = (msg) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(''), 3500)
  }

  const refreshHistory = async () => {
    try {
      const res = await api.listJobs()
      setJobsHistory(res.jobs || [])
    } catch (err) {
      console.error('refreshHistory falhou:', err)
    }
  }

  const refreshAdmin = async () => {
    try {
      const s = await api.getAdminSummary()
      setAdminSummary(s)
    } catch (err) {
      console.error('refreshAdmin falhou:', err)
    }
  }

  useEffect(() => {
    refreshHistory()
    refreshAdmin()
  }, [])

  useEffect(() => {
    if (tab === 'history') {
      refreshHistory()
    }
  }, [tab])

  // Polling ativo do lote em execução
  useEffect(() => {
    const activeId = activeJob?.task_id || activeJob?.id || activeJob?.job_id
    if (!activeId) return

    const normalizedSt = normalizeStatus(activeJob?.status)
    const isRunning = normalizedSt === 'RUNNING' || normalizedSt === 'PENDING'

    const poll = async () => {
      try {
        const [statusData, logData] = await Promise.all([
          api.getJob(activeId),
          api.getJobLogs(activeId, cursorRef.current),
        ])

        if (statusData) {
          const updatedStatus = normalizeStatus(statusData.status || statusData.job?.status)
          setActiveJob((prev) => ({
            ...prev,
            status: updatedStatus,
            percent: statusData.percent ?? statusData.job?.percent ?? prev?.percent ?? 0,
            processed_lines: statusData.processed_lines ?? statusData.job?.processed_lines ?? prev?.processed_lines ?? 0,
            total_lines: statusData.total_lines ?? statusData.job?.total_lines ?? prev?.total_lines,
            current_phase: statusData.current_phase ?? statusData.job?.current_phase ?? (updatedStatus === 'COMPLETED' ? 'F5' : 'F3'),
            error: statusData.error || statusData.job?.error || prev?.error,
          }))

          if (statusData.items && Array.isArray(statusData.items) && statusData.items.length > 0) {
            setItems(statusData.items)
          } else if (updatedStatus === 'FAILED') {
            setItems((prevItems) =>
              prevItems.map((it) => ({
                ...it,
                status: 'FAILED',
                message: statusData.error || it.message || 'Falha na execução da cotação',
              }))
            )
          }
        }

        if (logData && Array.isArray(logData.lines) && logData.lines.length > 0) {
          cursorRef.current = logData.next_cursor ?? cursorRef.current
          const newEntries = logData.lines.map((text) => ({
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
            level: text.toLowerCase().includes('erro') || text.toLowerCase().includes('exception')
              ? 'ERROR'
              : text.toLowerCase().includes('conclu') || text.toLowerCase().includes('sucesso')
              ? 'SUCCESS'
              : 'INFO',
            phase: 'AUTO',
            message: text,
          }))
          setLogs((prev) => [...prev, ...newEntries])
        }
      } catch (err) {}
    }

    poll()
    if (!isRunning) return

    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [activeJob?.task_id, activeJob?.id, activeJob?.status])

  // Carrega artefatos do lote ativo
  useEffect(() => {
    const activeId = activeJob?.task_id || activeJob?.id || activeJob?.job_id
    if (!activeId) return
    api.getJobArtifacts(activeId).then((res) => {
      if (res && Array.isArray(res.items)) {
        setJobArtifacts(res.items)
      }
    }).catch(() => {})
  }, [activeJob?.task_id, activeJob?.id, activeJob?.status])

  // Auto-scroll do terminal
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // Upload com pré-validação
  const handleFileUpload = async (file) => {
    if (!file) return
    const maxSizeBytes = cfg.upload?.maxSizeBytes || 100 * 1024 * 1024
    if (file.size > maxSizeBytes) {
      notify(`Arquivo excede o limite máximo de ${cfg.upload?.maxSizeKB || 100} KB (${(file.size / 1024).toFixed(1)} KB).`)
      return
    }
    setSelectedFile(file)
    setValidationReport(null)
    try {
      notify('Validando estrutura da planilha…')
      const report = await api.uploadAndValidate(
        file,
        formatDateForApi(dataReferencia),
        tipoOperacao
      )
      setValidationReport(report)
      if (report.preview && report.preview.length > 0) {
        setItems(report.preview)
      }
      setActiveJob({
        id: report.job_id,
        job_id: report.job_id,
        filename: report.filename,
        status: 'PENDING',
        current_phase: 'F1',
        percent: 0,
        total_items: report.total_rows || 0,
      })
      notify(`Planilha validada: ${report.valid_rows_count} linha(s) pronta(s)`)
    } catch (err) {
      notify(`Erro na validação: ${err.message}`)
    }
  }

  // Iniciar cotação
  const handleStart = async () => {
    if (!validationReport && !selectedFile) {
      notify('Selecione e valide uma planilha primeiro.')
      return
    }
    if (!usuario || !senha) {
      notify('Informe o usuário e a senha da automação.')
      return
    }
    if (!dataReferencia) {
      notify('Informe a data da cotação.')
      return
    }

    setIsStarting(true)
    cursorRef.current = 0
    setLogs([
      {
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
        level: 'INFO',
        phase: 'F1',
        message: 'Iniciando automação com parâmetros configurados…',
      },
    ])

    try {
      const jobId = activeJob?.job_id || validationReport?.job_id
      const payload = {
        usuario,
        senha,
        data_referencia: formatDateForApi(dataReferencia),
        validade: formatDateForApi(dataReferencia),
        tipo_operacao: tipoOperacao,
        headless: true,
        throttle_seconds: 2.5,
      }

      const res = await api.startJob(jobId || 'new', payload)

      setActiveJob((prev) => ({
        ...prev,
        task_id: res.task_id || prev?.id,
        status: 'RUNNING',
        current_phase: 'F2',
      }))
      notify('Automação iniciada com sucesso.')
      refreshHistory()
    } catch (err) {
      notify(`Falha ao iniciar: ${err.message}`)
      setActiveJob((prev) => (prev ? { ...prev, status: 'FAILED' } : null))
    } finally {
      setIsStarting(false)
    }
  }

  const handleStop = () => {
    if (activeJob) {
      setActiveJob((prev) => ({ ...prev, status: 'CANCELLED' }))
      setLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
          level: 'ERROR',
          phase: 'GERAL',
          message: 'Execução interrompida pelo operador.',
        },
      ])
      notify('Execução cancelada.')
    }
  }

  const openHistoricalJob = async (jobId) => {
    try {
      notify(`Carregando dados do lote ${jobId}…`)
      const res = await api.getJob(jobId)
      const logRes = await api.getJobLogs(jobId, 0)

      setActiveJob({
        id: jobId,
        job_id: jobId,
        task_id: res.task_id || jobId,
        filename: res.filename || res.job?.filename || `Lote ${jobId}`,
        status: normalizeStatus(res.status || res.job?.status),
        percent: res.percent ?? (res.status === 'SUCCESS' ? 1 : 0),
        current_phase: res.status === 'SUCCESS' ? 'F5' : 'F1',
        total_items: res.total_lines || 0,
        processed_lines: res.processed_lines || 0,
      })

      if (res.items && res.items.length > 0) {
        setItems(res.items)
      }

      if (logRes.lines && logRes.lines.length > 0) {
        setLogs(
          logRes.lines.map((t) => ({
            timestamp: '--:--',
            level: 'INFO',
            phase: 'LOG',
            message: t,
          }))
        )
      } else {
        setLogs([])
      }

      setTab('execution')
    } catch (err) {
      notify(`Falha ao abrir lote: ${err.message}`)
    }
  }

  const normalizedActiveStatus = normalizeStatus(activeJob?.status)
  const isJobRunning = normalizedActiveStatus === 'RUNNING'

  return (
    <div className="shell">
      {/* Barra Lateral Idêntica à Referência */}
      <aside>
        <div className="sidebar-brand-ref">
          <div className="sidebar-brand-title">
            <span>LogTudo</span> <strong>Cotações</strong>
          </div>
          <div className="sidebar-brand-version">AUTOMAÇÃO v2.0</div>
        </div>

        <nav className="sidebar-nav">
          <button
            type="button"
            className={tab === 'execution' ? 'active' : ''}
            onClick={() => setTab('execution')}
          >
            Cotação de Frete
          </button>
          <button
            type="button"
            className={tab === 'history' ? 'active' : ''}
            onClick={() => {
              setTab('history')
              refreshHistory()
            }}
          >
            Histórico
          </button>
          <button
            type="button"
            className={tab === 'admin' ? 'active' : ''}
            onClick={() => {
              setTab('admin')
              refreshAdmin()
            }}
          >
            Admin
          </button>
        </nav>

        {/* Card Lote Ativo Conforme Imagem de Referência */}
        {activeJob || validationReport ? (
          <div className="sidebar-lote-box-active">
            <span className="sidebar-lote-title">LOTE ATIVO</span>
            <div className="sidebar-lote-id mono">
              {String(activeJob?.job_id || validationReport?.job_id || '—')}
            </div>
            <div className="sidebar-lote-metrics">
              <span>{activeJob?.processed_lines || 0}/{activeJob?.total_items || validationReport?.total_rows || items.length || 0}</span>
              <span className="sidebar-lote-percent">{activeJob?.percent || 0}%</span>
            </div>
            <div className="sidebar-lote-prog-bar">
              <div
                className="sidebar-lote-prog-fill"
                style={{ width: `${activeJob?.percent || 0}%` }}
              />
            </div>
            <div className="sidebar-lote-status-line">
              <span className="sidebar-lote-sublabel">PROCESSANDO</span>
              <span className="sidebar-lote-badge">
                {isJobRunning ? 'Executando' : 'Aguardando'}
              </span>
            </div>
          </div>
        ) : (
          <div className="sidebar-lote-box">
            <span className="sidebar-lote-title">LOTE ATIVO</span>
            <div className="sidebar-lote-empty">
              <em>Nenhum lote em andamento</em>
            </div>
          </div>
        )}

        <footer>
          <a
            className="nav-link-btn"
            href={`${api.prefix}/manual-de-uso`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '11px', color: 'var(--muted)' }}
          >
            Manual de Uso ↗
          </a>
        </footer>
      </aside>

      {/* Conteúdo Principal - Sem Header no topo */}
      <main>
        {/* Aba Execução */}
        {tab === 'execution' && (
          <div className="stack">
            {/* Grid Superior: Credenciais à esquerda, Planilha à direita */}
            <div className="grid two-col">
              {/* Container Esquerda: Credenciais do ERP & Filtros */}
              <div className="card">
                <h2 className="card-section-title">CREDENCIAIS DO PORTAL & FILTROS</h2>

                <div className="field-block">
                  <label>Usuário</label>
                  <input
                    type="text"
                    value={usuario}
                    placeholder="AtualizarBI"
                    onChange={(e) => setUsuario(e.target.value)}
                  />
                </div>

                <div className="field-block">
                  <label>Senha</label>
                  <div className="input-password-wrap">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      placeholder="••••••••••••"
                      onChange={(e) => setSenha(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha((v) => !v)}
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                    >
                      {showSenha ? 'Ocultar' : 'Ver'}
                    </button>
                  </div>
                </div>

                <div className="grid two-col" style={{ gap: '10px', marginBottom: '14px' }}>
                  <div className="field-block" style={{ marginBottom: 0 }}>
                    <label>Data da cotação</label>
                    <input
                      type="date"
                      value={dataReferencia}
                      onChange={(e) => setDataReferencia(e.target.value)}
                    />
                  </div>

                  <div className="field-block" style={{ marginBottom: 0 }}>
                    <label>Operação</label>
                    <select
                      value={tipoOperacao}
                      onChange={(e) => setTipoOperacao(e.target.value)}
                    >
                      {cfg.operations.map((op) => (
                        <option key={op.code} value={op.code}>
                          {op.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {validationReport || activeJob?.id ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn-primary-block"
                      style={{ flex: 1 }}
                      disabled={isStarting || isJobRunning}
                      onClick={handleStart}
                    >
                      {isStarting ? 'Iniciando cotação…' : 'Iniciar cotação'}
                    </button>
                    {isJobRunning && (
                      <button
                        type="button"
                        className="danger"
                        style={{ padding: '8px 14px', borderRadius: 'var(--radius-sm)' }}
                        onClick={handleStop}
                      >
                        Interromper
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-primary-block"
                    onClick={() => {
                      if (!usuario || !senha) {
                        notify('Preencha usuário e senha.')
                        return
                      }
                      localStorage.setItem(LS_KEYS.usuario, usuario)
                      localStorage.setItem(LS_KEYS.senha, senha)
                      notify('Credenciais salvas com sucesso no navegador!')
                    }}
                  >
                    Salvar credenciais
                  </button>
                )}
              </div>

              {/* Container Direita: Planilha de CTeS / Cotação */}
              <div className="card">
                <h2 className="card-section-title">PLANILHA DE COTAÇÃO</h2>

                <label className="dropzone-rect">
                  <div className="dropzone-rect-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <span className="dropzone-rect-primary">
                    {selectedFile ? selectedFile.name : 'Arraste a planilha de cotação (.xlsx) aqui ou clique para selecionar'}
                  </span>
                  <span className="dropzone-rect-secondary">
                    {selectedFile
                      ? `Tamanho:  (máx 100 MB)`
                      : 'A validação prévia roda automaticamente após o upload'}
                  </span>
                  <input
                    type="file"
                    accept={cfg.upload.accept}
                    onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  />
                </label>

                {validationReport && (
                  <div className="validation-summary" style={{ marginTop: '14px' }}>
                    <div>
                      <strong>{validationReport.filename}</strong>
                      <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '2px' }}>
                        {validationReport.valid_rows_count} linha(s) identificada(s)
                        {validationReport.invalid_rows_count > 0 && ` • ${validationReport.invalid_rows_count} pendente(s)`}
                      </div>
                    </div>
                    <StatusIndicator status={validationReport.is_valid ? 'SUCCESS' : 'FAILED'} />
                  </div>
                )}
              </div>
            </div>

            {/* Container Inferior Condicional: Nenhum lote em andamento OU Fases + Registros + Terminal */}
            {!validationReport && !activeJob?.id ? (
              <div className="card card-empty-state">
                <h3 className="empty-state-title">Nenhum lote em andamento</h3>
                <p className="empty-state-desc">
                  Preencha as credenciais do portal e filtros ao lado, carregue a planilha .xlsx e a validação prévia liberará o botão <strong>Iniciar cotação</strong>. O progresso e o log de execução aparecerão aqui durante o processamento.
                </p>
              </div>
            ) : (
              <>
                {/* Card Superior: Fases do processamento com 2 Barras de Progresso */}
                <div className="card batch-phases-card">
                  {/* Linha 1: Lote Ativo, Status Pill e ID */}
                  <div className="batch-header-line">
                    <div className="batch-header-left">
                      <span className="batch-label">LOTE ATIVO</span>
                      <span className={`batch-status-pill ${isJobRunning ? 'running' : normalizedActiveStatus === 'COMPLETED' ? 'completed' : normalizedActiveStatus === 'FAILED' ? 'failed' : 'ready'}`}>
                        {isJobRunning ? 'Em andamento' : normalizedActiveStatus === 'COMPLETED' ? 'Concluído' : normalizedActiveStatus === 'FAILED' ? 'Falhou' : 'Pronto'}
                      </span>
                      <span className="batch-id mono">
                        {String(activeJob?.job_id || validationReport?.job_id || '—')}
                      </span>
                    </div>
                  </div>

                  {/* Linha 2: Métricas de Itens e Percentual */}
                  <div className="batch-metrics-line">
                    <div className="batch-items-count">
                      {activeJob?.processed_lines || 0}/{activeJob?.total_items || validationReport?.total_rows || items.length || 0} itens ({items.filter(i => (i.status === 'FAILED' || i.status === 'ERROR')).length} falhas)
                    </div>
                    <div className="batch-percent-val" style={{ color: normalizedActiveStatus === 'FAILED' ? '#ef4444' : undefined }}>
                      {activeJob?.percent || 0}%
                    </div>
                  </div>

                  {/* Duas barras de progresso */}
                  <div className="batch-progress-bars">
                    {/* Barra 1: Progresso Geral dos Itens */}
                    <div className="batch-progress-bar-primary">
                      <div
                        className={`batch-progress-fill-primary ${normalizedActiveStatus === 'FAILED' ? 'error' : ''}`}
                        style={{ width: `${normalizedActiveStatus === 'FAILED' ? 100 : (activeJob?.percent || 0)}%` }}
                      />
                    </div>
                    {/* Barra 2: Progresso das Fases (F1 a F5) */}
                    <div className="batch-progress-bar-secondary">
                      <div
                        className={`batch-progress-fill-secondary ${normalizedActiveStatus === 'FAILED' ? 'error' : ''}`}
                        style={{
                          width: `${normalizedActiveStatus === 'FAILED' ? 100 : Math.min(100, Math.max(15, ((Math.max(0, cfg.phases.findIndex((x) => x.id === (activeJob?.current_phase || 'F1'))) + (isJobRunning ? 0.5 : 1)) / cfg.phases.length) * 100))}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* COTAÇÃO EM PROCESSAMENTO — */}
                  <div className="batch-processing-subhead">
                    <span style={{ color: normalizedActiveStatus === 'FAILED' ? '#ef4444' : undefined }}>
                      {normalizedActiveStatus === 'FAILED' ? 'COTAÇÃO INTERROMPIDA POR ERRO' : 'COTAÇÃO EM PROCESSAMENTO'}
                    </span>
                    <span className="batch-processing-item" style={{ color: normalizedActiveStatus === 'FAILED' ? '#fca5a5' : undefined }}>
                      {normalizedActiveStatus === 'FAILED'
                        ? (activeJob?.error ? `— ${activeJob.error}` : '— Ocorreu uma falha no processamento')
                        : isJobRunning
                        ? (items.find(i => i.status === 'RUNNING')?.nome || '— Processando itens…')
                        : ''}
                    </span>
                  </div>

                  {/* Stepper F1 a F5 Conforme a Imagem de Referência */}
                  <div className="phase-stepper-container">
                    <div className="phase-stepper-track" />
                    <div className="phase-stepper-nodes">
                      {cfg.phases.map((p, idx) => {
                        const currentIdx = Math.max(
                          0,
                          cfg.phases.findIndex((x) => x.id === (activeJob?.current_phase || 'F1'))
                        )
                        const isDone = idx < currentIdx || normalizedActiveStatus === 'COMPLETED'
                        const isCurrent = idx === currentIdx
                        const isFailedPhase = normalizedActiveStatus === 'FAILED' && isCurrent

                        return (
                          <div
                            key={p.id}
                            className={`phase-step-col ${isFailedPhase ? 'failed' : isDone ? 'done' : isCurrent ? 'current' : ''}`}
                          >
                            <div className="phase-step-circle">
                              {isFailedPhase ? '✕' : p.id}
                            </div>
                            <div className="phase-step-info">
                              <span className="phase-step-title">{p.title}</span>
                              <span className="phase-step-sub">{isFailedPhase ? 'Falhou' : p.subtitle}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Grid Inferior: Console à esquerda (50%), Registros à direita (50%) */}
                <div className="grid two-col bottom-work-grid">
                  {/* Card Esquerda: Console de Execução (Mac Style) */}
                  <div className="card terminal-execution-card">
                    <div className="terminal-mac-header">
                      <div className="mac-dots">
                        <span className="mac-dot red" />
                        <span className="mac-dot yellow" />
                        <span className="mac-dot green" />
                      </div>
                      <span className="terminal-mac-title">Console de Execução</span>
                      <div className="terminal-actions">
                        <input
                          type="text"
                          className="terminal-filter-input"
                          placeholder="Filtrar log..."
                          value={logFilter}
                          onChange={(e) => setLogFilter(e.target.value)}
                        />
                        <select
                          className="terminal-select"
                          value={logLevel}
                          onChange={(e) => setLogLevel(e.target.value)}
                        >
                          <option value="TODOS">TODOS ˅</option>
                          <option value="INFO">INFO</option>
                          <option value="SUCCESS">SUCESSO</option>
                          <option value="ERROR">ERRO</option>
                        </select>
                        <button
                          type="button"
                          className="terminal-action-btn"
                          title="Rolar para o fim"
                          onClick={() => {
                            if (logContainerRef.current) {
                              logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
                            }
                          }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="terminal-action-btn"
                          title="Copiar logs"
                          onClick={copyLogs}
                        >
                          ⧉
                        </button>
                      </div>
                    </div>

                    <div className="terminal-content-viewport" ref={logContainerRef}>
                      {filteredLogs.length > 0 ? (
                        filteredLogs.map((l, i) => (
                          <div key={i} className={`log-row ${l.level.toLowerCase()}`}>
                            <time className="log-time">{l.timestamp || '--:--:--'}</time>
                            <span className={`log-badge ${l.level.toLowerCase()}`}>[{l.level}]</span>
                            <span className="log-text">{l.message}</span>
                          </div>
                        ))
                      ) : (
                        <div className="terminal-empty-msg">
                          Nenhum evento registrado no console até o momento.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Direita: ITENS DO LOTE */}
                  <div className="card batch-items-card">
                    <div className="batch-items-header">
                      <span className="batch-items-title">ITENS DO LOTE</span>
                      <div className="batch-items-filters">
                        <input
                          type="text"
                          className="batch-search-input"
                          placeholder="Cotação, motorista, placa..."
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                        />
                        <select
                          className="batch-status-select"
                          value={itemStatusFilter}
                          onChange={(e) => setItemStatusFilter(e.target.value)}
                        >
                          <option value="TODOS">TODOS ˅</option>
                          <option value="PENDING">Pendente</option>
                          <option value="SUCCESS">Sucesso</option>
                          <option value="FAILED">Falha</option>
                        </select>
                      </div>
                    </div>

                    <div className="batch-table-container">
                      <table className="batch-items-table">
                        <thead>
                          <tr>
                            <th>NÚMERO</th>
                            <th>MOTORISTA / PLACA</th>
                            <th>FRETE VALOR</th>
                            <th>FRETE NEGOCIADO</th>
                            <th>STATUS</th>
                            <th style={{ textAlign: 'center' }}>DET.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredItems.length > 0 ? (
                            filteredItems.map((item, idx) => (
                              <tr key={item.id || idx}>
                                <td className="mono" style={{ fontWeight: 600 }}>
                                  {item.reference || item.numero || item.row || `${idx + 1}`}
                                </td>
                                <td>
                                  <div className="driver-name">{item.nome || item.nome_motorista || 'MOTORISTA NÃO INFORMADO'}</div>
                                  <div className="driver-plate mono">{item.placa || 'SEM PLACA'}</div>
                                </td>
                                <td className="mono">
                                  {item.frete_valor ? `R$ ${item.frete_valor}` : (item.valor ? `R$ ${item.valor}` : '—')}
                                </td>
                                <td className="mono">
                                  {item.frete_negociado ? `R$ ${item.frete_negociado}` : '—'}
                                </td>
                                <td>
                                  <span className={`item-status-pill ${item.status?.toLowerCase() || 'pending'}`}>
                                    {formatItemStatus(item.status)}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="item-det-btn"
                                    title="Ver detalhes"
                                    onClick={() => setSelectedItemDetail((prev) => (prev?.id === item.id ? null : item))}
                                  >
                                    👁
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="6" className="batch-empty-table">
                                Nenhum item encontrado no lote.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Painel Integrado de Detalhes do Registro (Conforme Imagem de Referência) */}
                    {selectedItemDetail && (
                      <div className="item-detail-panel">
                        <div className="item-detail-top">
                          <div className="item-detail-id-wrap">
                            <span className="item-detail-id mono">
                              {selectedItemDetail.reference || selectedItemDetail.numero || selectedItemDetail.row || '—'}
                            </span>
                            <span className={`item-status-pill ${selectedItemDetail.status?.toLowerCase() || 'pending'}`}>
                              {formatItemStatus(selectedItemDetail.status)}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="item-detail-close-btn"
                            title="Fechar detalhes"
                            onClick={() => setSelectedItemDetail(null)}
                          >
                            ✕
                          </button>
                        </div>

                        <div className="item-detail-grid">
                          <div className="item-detail-cell">
                            <span className="item-detail-cell-label">LINHA / COTAÇÃO</span>
                            <span className="item-detail-cell-value mono">
                              #{selectedItemDetail.row || '—'} · {selectedItemDetail.reference || selectedItemDetail.numero || '—'}
                            </span>
                          </div>
                          <div className="item-detail-cell">
                            <span className="item-detail-cell-label">CTE EMITIDO</span>
                            <span className="item-detail-cell-value mono">
                              {selectedItemDetail.cte || selectedItemDetail.contrato || '—'}
                            </span>
                          </div>
                          <div className="item-detail-cell">
                            <span className="item-detail-cell-label">MOTORISTA</span>
                            <span className="item-detail-cell-value">
                              {selectedItemDetail.nome || selectedItemDetail.nome_motorista || 'MOTORISTA NÃO INFORMADO'} · {selectedItemDetail.placa || 'SEM PLACA'}
                            </span>
                          </div>
                          <div className="item-detail-cell">
                            <span className="item-detail-cell-label">DURAÇÃO</span>
                            <span className="item-detail-cell-value mono">
                              {selectedItemDetail.duration || selectedItemDetail.duracao || '—'}
                            </span>
                          </div>
                        </div>

                        {/* Bloco de Erro, Sucesso ou Pendente */}
                        {isErrorStatus(selectedItemDetail.status) ? (
                          <div className="item-detail-reason-box error">
                            <span className="item-detail-reason-title">MOTIVO DO ERRO</span>
                            <span className="item-detail-reason-text">
                              {selectedItemDetail.message || selectedItemDetail.error || 'Falha na validação ou processamento do registro.'}
                            </span>
                            <div className="item-detail-screenshot-wrap">
                              <span style={{ color: '#94a3b8' }}>Screenshot:</span>
                              {selectedItemScreenshotUrl ? (
                                <a
                                  href={selectedItemScreenshotUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="screenshot-link"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    setPreviewScreenshotModal(selectedItemScreenshotUrl)
                                  }}
                                >
                                  📷 Ver screenshot do erro ↗
                                </a>
                              ) : (
                                <span style={{ color: '#64748b', fontStyle: 'italic' }}>
                                  Validação prévia de dados (sem captura de tela)
                                </span>
                              )}
                            </div>
                          </div>
                        ) : isSuccessStatus(selectedItemDetail.status) ? (
                          <div className="item-detail-reason-box success">
                            <span className="item-detail-reason-title">RESULTADO DA COTAÇÃO</span>
                            <span className="item-detail-reason-text">
                              Cotação processada e confirmada com sucesso!
                            </span>
                            {selectedItemScreenshotUrl && (
                              <div className="item-detail-screenshot-wrap">
                                <span style={{ color: '#94a3b8' }}>Evidência:</span>
                                <a
                                  href={selectedItemScreenshotUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="screenshot-link"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    setPreviewScreenshotModal(selectedItemScreenshotUrl)
                                  }}
                                >
                                  📷 Ver comprovante ↗
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="item-detail-reason-box pending">
                            <span className="item-detail-reason-title">STATUS DO REGISTRO</span>
                            <span className="item-detail-reason-text">
                              {selectedItemDetail.message || 'Linha validada e pronta para processamento.'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Aba Histórico */}
        {tab === 'history' && (
          <HistoryTab
            jobs={jobsHistory}
            onOpenJob={openHistoricalJob}
            onViewDetails={(job) => setHistoryDetailJob(job)}
            onRefresh={refreshHistory}
          />
        )}

        {/* Aba Admin */}
        {tab === 'admin' && (
          <AdminTab
            summary={adminSummary}
            jobs={jobsHistory}
            onRefresh={() => {
              refreshAdmin()
              refreshHistory()
            }}
            notify={notify}
          />
        )}
      </main>

      {/* Modal de Zoom do Screenshot */}
      {previewScreenshotModal && (
        <div
          className="screenshot-preview-modal-backdrop"
          onClick={() => setPreviewScreenshotModal(null)}
        >
          <div
            className="screenshot-preview-modal-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="screenshot-preview-modal-header">
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                Screenshot da Evidência / Erro
              </span>
              <button
                type="button"
                className="item-detail-close-btn"
                onClick={() => setPreviewScreenshotModal(null)}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '12px', display: 'flex', justifyContent: 'center', background: '#070a12' }}>
              <img
                src={previewScreenshotModal}
                alt="Screenshot do erro"
                className="screenshot-preview-modal-img"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Execução do Histórico (Fiel à Imagem de Referência) */}
      {historyDetailJob && (
        <HistoryJobDetailModal
          job={historyDetailJob}
          onClose={() => setHistoryDetailJob(null)}
          onOpenScreenshot={(url) => setPreviewScreenshotModal(url)}
        />
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="toast" onClick={() => setToastMessage('')}>
          {toastMessage}
        </div>
      )}
    </div>
  )
}

function StatusIndicator({ status, customText }) {
  const norm = normalizeStatus(status)
  const meta = statusMap[norm] || { label: status || 'Aguardando', tone: '' }
  return (
    <span className={`status-indicator ${meta.tone}`}>
      <span className="dot" />
      <span>{customText || meta.label}</span>
    </span>
  )
}

function formatDuration(sec) {
  if (sec === null || sec === undefined || sec === '') return '—'
  const s = Number(sec)
  if (isNaN(s) || s <= 0) return '—'
  if (s < 60) return `${Math.round(s)}s`
  const min = Math.floor(s / 60)
  const remSec = Math.round(s % 60)
  return `${min}m${remSec.toString().padStart(2, '0')}s`
}

function formatHistoryDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`
  } catch {
    return dateStr
  }
}

function formatHistoryDateFull(val) {
  if (!val) return '—'
  try {
    const d = new Date(val)
    if (Number.isNaN(d.getTime())) return String(val).replace('T', ' ')
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`
  } catch {
    return String(val)
  }
}

function getHistoryStatusMeta(status) {
  const norm = normalizeStatus(status)
  if (norm === 'COMPLETED') return { label: 'Concluído', tone: 'completed' }
  if (norm === 'RUNNING') return { label: 'Executando', tone: 'running' }
  if (norm === 'FAILED') return { label: 'Falhou', tone: 'failed' }
  if (norm === 'CANCELLED' || norm === 'CANCELED') return { label: 'Cancelado', tone: 'canceled' }
  return { label: 'Aguardando', tone: 'waiting' }
}

function HistoryTab({ jobs, onOpenJob, onViewDetails, onRefresh }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('TODOS')

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      const matchSearch =
        search === '' ||
        `${j.id} ${j.job_id} ${j.task_id} ${j.filename || ''}`.toLowerCase().includes(search.toLowerCase())

      if (statusFilter !== 'TODOS') {
        const norm = normalizeStatus(j.status)
        if (statusFilter === 'COMPLETED' && norm !== 'COMPLETED') return false
        if (statusFilter === 'CANCELLED' && norm !== 'CANCELLED' && norm !== 'CANCELED') return false
        if (statusFilter === 'FAILED' && norm !== 'FAILED') return false
        if (statusFilter === 'PENDING' && norm !== 'PENDING') return false
      }
      return matchSearch
    })
  }, [jobs, search, statusFilter])

  return (
    <div className="stack">
      {/* Barra de Título e Filtros Conforme Imagem de Referência */}
      <div className="history-header-bar">
        <div className="history-header-title-wrap">
          <h2 className="history-header-title" style={{ margin: 0 }}>Histórico de Lotes</h2>
          <span className="history-header-count">
            {filtered.length} de {jobs.length}
          </span>
        </div>

        <div className="history-controls">
          <input
            type="text"
            className="history-search-input"
            placeholder="Buscar por arquivo, lote..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="history-status-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="TODOS">TODOS ˅</option>
            <option value="COMPLETED">Concluído</option>
            <option value="CANCELLED">Cancelado</option>
            <option value="FAILED">Falhou</option>
            <option value="PENDING">Aguardando</option>
          </select>
        </div>
      </div>

      {/* Card da Tabela de Histórico */}
      <div className="card history-table-card">
        <div className="history-table-wrapper">
          <table className="history-table">
            <thead>
              <tr>
                <th>LOTE</th>
                <th>ARQUIVO</th>
                <th>STATUS</th>
                <th>PROGRESSO</th>
                <th>ITENS</th>
                <th>DURAÇÃO</th>
                <th>CRIADO EM</th>
                <th style={{ textAlign: 'center' }}>RASTREIO</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? (
                filtered.map((j) => {
                  const statusMeta = getHistoryStatusMeta(j.status)
                  const total = j.total_items ?? j.total_lines ?? (j.items?.length) ?? 0
                  const processed = j.processed_lines ?? j.success_count ?? (statusMeta.tone === 'completed' ? total : 0)
                  const errors = j.error_count ?? j.failed_items ?? 0
                  const percent = j.percent ?? (total > 0 ? Math.round((processed / total) * 100) : (statusMeta.tone === 'completed' ? 100 : 0))

                  return (
                    <tr
                      key={j.id || j.task_id || j.job_id}
                      style={{ cursor: 'pointer' }}
                      onDoubleClick={() => onViewDetails && onViewDetails(j)}
                    >
                      <td className="mono history-lote-id">
                        {j.job_id || j.id || j.task_id}
                      </td>
                      <td>
                        <span className="history-filename" title={j.filename || 'Planilha de Cotação'}>
                          {j.filename || 'relatorio.xlsx'}
                        </span>
                      </td>
                      <td>
                        <span className={`history-status-pill ${statusMeta.tone}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>
                        <div className="history-progress-wrap">
                          <div
                            className="history-progress-fill"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </td>
                      <td>
                        <span className="history-item-count">{processed}/{total}</span>
                        {errors > 0 && (
                          <span className="history-err-count"> ({errors} err)</span>
                        )}
                      </td>
                      <td className="mono history-duration">
                        {formatDuration(j.duration_sec ?? j.duration)}
                      </td>
                      <td className="mono history-date">
                        {formatHistoryDate(j.created_at || j.started_at)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="history-actions-cell" style={{ justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="history-action-btn"
                            title="Ver detalhes da execução"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (onViewDetails) onViewDetails(j)
                            }}
                          >
                            👁
                          </button>
                          <a
                            href={`${api.prefix}/api/admin/jobs/${encodeURIComponent(j.job_id || j.id || j.task_id)}/artifacts`}
                            target="_blank"
                            rel="noreferrer"
                            className="history-action-btn"
                            title="Baixar artefatos do lote"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ⤓
                          </a>
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', color: '#64748b', padding: '36px 16px', fontStyle: 'italic' }}>
                    Nenhum lote encontrado no histórico.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function HistoryJobDetailModal({ job, onClose, onOpenScreenshot }) {
  const jobId = job.job_id || job.id || job.task_id
  const statusMeta = getHistoryStatusMeta(job.status)

  const [items, setItems] = useState(() => (Array.isArray(job.items) ? job.items : []))
  const [artifacts, setArtifacts] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.all([
      api.getJob(jobId).catch(() => null),
      api.getJobArtifacts(jobId).catch(() => null),
    ]).then(([jobRes, artRes]) => {
      if (!active) return

      // Itens reais do lote
      let loadedItems = []
      if (jobRes?.items && Array.isArray(jobRes.items) && jobRes.items.length > 0) {
        loadedItems = jobRes.items
      } else if (jobRes?.job?.items && Array.isArray(jobRes.job.items) && jobRes.job.items.length > 0) {
        loadedItems = jobRes.job.items
      } else if (job.items && Array.isArray(job.items) && job.items.length > 0) {
        loadedItems = job.items
      }

      const isJobFailed = statusMeta.tone === 'failed' || String(job.status || '').toLowerCase() === 'error' || String(job.status || '').toUpperCase() === 'FAILED' || String(job.status || '').toUpperCase() === 'FAILURE' || String(jobRes?.status || '').toUpperCase() === 'FAILURE'

      if (loadedItems.length > 0 && isJobFailed) {
        loadedItems = loadedItems.map((it) => ({
          ...it,
          status: it.status && it.status !== 'PENDING' ? it.status : 'FAILED',
          message: it.message || jobRes?.error || 'Falha na execução',
        }))
      }
      setItems(loadedItems)

      // Artefatos reais do lote
      let loadedArtifacts = []
      if (artRes?.items && Array.isArray(artRes.items) && artRes.items.length > 0) {
        loadedArtifacts = artRes.items.map((a) => {
          const name = a.filename || a.name || 'arquivo'
          let ref = '—'
          if (name.includes('GERAL')) ref = 'GERAL'
          else {
            const m = name.match(/erro_cotacao_(\d+)_/)
            if (m) ref = m[1]
          }
          let type = 'ARQUIVO'
          if (name.endsWith('.png') || name.endsWith('.jpg')) type = 'SCREENSHOT_ERROR'
          else if (name.endsWith('.xlsx') || name.endsWith('.xls')) type = 'EXCEL_RESULT'
          else if (name.endsWith('.webm') || name.endsWith('.mp4')) type = 'VIDEO_RECORDING'
          return {
            id: a.id,
            type: a.type || type,
            filename: name,
            reference: ref,
            size_bytes: a.size_bytes || 0,
            url: api.getArtifactDownloadUrl(a.id),
            isImage: name.endsWith('.png') || name.endsWith('.jpg'),
          }
        })
      }
      setArtifacts(loadedArtifacts)
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [jobId])

  // Contadores KPI baseados em dados reais
  const countSuccess = job.success_count ?? items.filter((i) => {
    const s = String(i.status || '').toUpperCase()
    return s.includes('CONCLU') || s.includes('SUCC') || s.includes('OK')
  }).length

  const isJobFailed = statusMeta.tone === 'failed' || String(job.status || '').toLowerCase() === 'error' || String(job.status || '').toUpperCase() === 'FAILED' || String(job.status || '').toUpperCase() === 'FAILURE'

  const countError = job.error_count ?? (
    items.filter((i) => {
      const s = String(i.status || '').toUpperCase()
      return s.includes('FAIL') || s.includes('FALHA') || s.includes('ERR')
    }).length || (isJobFailed ? Math.max(1, items.length) : 0)
  )

  const countPending = job.pending_count ?? items.filter((i) => {
    const s = String(i.status || '').toUpperCase()
    return (s.includes('PEND') || s.includes('AGUARD')) && !s.includes('FAIL') && !s.includes('ERR')
  }).length

  const handleArtifactClick = (art) => {
    if (art.isImage || (art.filename && (art.filename.endsWith('.png') || art.filename.endsWith('.jpg')))) {
      if (art.url) {
        onOpenScreenshot(art.url)
      }
    } else if (art.url) {
      window.open(art.url, '_blank')
    }
  }

  const handleItemDetailClick = (item) => {
    const ref = String(item.cotacao || item.reference || item.numero || '')
    const matched = artifacts.find((a) => ref && a.filename && a.filename.includes(ref))
    if (matched && matched.url) {
      handleArtifactClick(matched)
    }
  }

  return (
    <div className="history-modal-overlay" onClick={onClose}>
      <div className="history-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header do Modal */}
        <div className="history-modal-header">
          <div className="history-modal-top-line">
            <div className="history-modal-badge-group">
              <span className={`history-status-pill ${statusMeta.tone}`}>
                {statusMeta.label}
              </span>
              <span className="mono history-modal-lote-id">
                {jobId}
              </span>
            </div>
            <button
              type="button"
              className="history-modal-close-btn"
              onClick={onClose}
              title="Fechar (Esc)"
            >
              ✕ Fechar
            </button>
          </div>

          <h3 className="history-modal-filename">
            {job.filename || job.arquivo || 'Planilha de Cotação'}
          </h3>

          <div className="history-modal-meta-line">
            {formatHistoryDateFull(job.created_at || job.started_at)} · {job.duration_sec != null ? formatDuration(job.duration_sec) : (job.duration || '—')} · operador:{' '}
            <span className="history-modal-operator">{job.username || job.operador || 'sistema'}</span>
          </div>
        </div>

        {/* Corpo do Modal */}
        <div className="history-modal-body">
          {/* Cards KPI (3 Colunas: Concluídos, Erros, Pendentes) */}
          <div className="history-modal-kpi-grid">
            <div className="history-kpi-card">
              <span className="history-kpi-label">CONCLUÍDOS</span>
              <span className="history-kpi-val success">{countSuccess}</span>
            </div>
            <div className="history-kpi-card">
              <span className="history-kpi-label">ERROS</span>
              <span className="history-kpi-val error">{countError}</span>
            </div>
            <div className="history-kpi-card">
              <span className="history-kpi-label">PENDENTES</span>
              <span className="history-kpi-val pending">{countPending}</span>
            </div>
          </div>

          {/* Seção ITENS (N) */}
          <div>
            <div className="history-modal-section-title">
              ITENS ({items.length})
            </div>
            <div className="history-modal-table-wrap">
              <table className="history-modal-items-table">
                <thead>
                  <tr>
                    <th>LINHA</th>
                    <th>COTAÇÃO</th>
                    <th>MOTORISTA / PLACA</th>
                    <th>CTE</th>
                    <th>STATUS</th>
                    <th style={{ textAlign: 'center' }}>DET.</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: '#64748b', padding: '28px 16px', fontStyle: 'italic' }}>
                        {loading ? 'Carregando itens...' : 'Nenhum item registrado para este lote.'}
                      </td>
                    </tr>
                  ) : (
                    items.map((item, idx) => {
                      const rowNum = item.row ?? (idx + 1)
                      const cotacaoNum = item.cotacao || item.reference || item.numero || '—'
                      const motorista = item.nome || item.nome_motorista || 'MOTORISTA NÃO INFORMADO'
                      const placa = item.placa || 'SEM PLACA'
                      const isCteEmitido =
                        String(item.cte || '').toUpperCase().includes('EMIT') ||
                        (!item.error && !String(item.status || '').toUpperCase().includes('FAIL'))
                      const isFailed =
                        String(item.status || '').toUpperCase().includes('FAIL') ||
                        String(item.status || '').toUpperCase().includes('FALHA')

                      return (
                        <tr key={idx}>
                          <td className="mono" style={{ color: '#94a3b8' }}>{rowNum}</td>
                          <td className="mono" style={{ fontWeight: 600, color: '#f8fafc' }}>{cotacaoNum}</td>
                          <td>
                            <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#f1f5f9' }}>{motorista}</div>
                            <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px', fontFamily: 'monospace' }}>{placa}</div>
                          </td>
                          <td>
                            {isCteEmitido ? (
                              <span className="cte-badge-emitido">EMITIDO</span>
                            ) : (
                              <span style={{ color: '#64748b' }}>—</span>
                            )}
                          </td>
                          <td>
                            {isFailed ? (
                              <span className="item-status-pill failed">Falha na Validação</span>
                            ) : (
                              <span className="item-status-pill success">Concluído</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="history-action-btn"
                              title="Ver detalhe do item"
                              onClick={() => handleItemDetailClick(item)}
                            >
                              👁
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Seção ARTIFACTS (N) */}
          <div>
            <div className="history-modal-section-title">
              ARTIFACTS ({artifacts.length})
            </div>
            <div className="history-modal-artifacts-list">
              {artifacts.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '24px 16px', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                  {loading ? 'Carregando artefatos...' : 'Nenhum artefato disponível para este lote.'}
                </div>
              ) : (
                artifacts.map((art, idx) => (
                  <div
                    key={idx}
                    className="history-artifact-item"
                    onClick={() => handleArtifactClick(art)}
                    title={art.isImage ? 'Clique para visualizar screenshot' : 'Clique para baixar artefato'}
                  >
                    <div className="history-artifact-left">
                      <span className="history-artifact-type">{art.type}</span>
                      <span className="history-artifact-name">{art.filename}</span>
                    </div>
                    <div className="history-artifact-right">
                      {art.reference && art.reference !== '—' && (
                        <span className="history-artifact-ref">{art.reference}</span>
                      )}
                      <span className="history-artifact-size">{formatFileSize(art.size_bytes)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AdminTab({ summary, jobs, onRefresh, notify }) {
  const [selectedJobId, setSelectedJobId] = useState('')
  const [subTab, setSubTab] = useState('steps')
  const [actions, setActions] = useState([])
  const [steps, setSteps] = useState([])
  const [browserLogs, setBrowserLogs] = useState([])
  const [artifacts, setArtifacts] = useState([])
  const [resetPass, setResetPass] = useState('')

  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) {
      setSelectedJobId(jobs[0].job_id || jobs[0].id)
    }
  }, [jobs])

  useEffect(() => {
    if (!selectedJobId) return
    if (subTab === 'actions') {
      api.getJobActions(selectedJobId).then((r) => setActions(r.items || [])).catch(() => setActions([]))
    } else if (subTab === 'steps') {
      api.getJobSteps(selectedJobId).then((r) => setSteps(r.items || [])).catch(() => setSteps([]))
    } else if (subTab === 'browser') {
      api.getJobBrowserLogs(selectedJobId).then((r) => setBrowserLogs(r.items || [])).catch(() => setBrowserLogs([]))
    } else if (subTab === 'artifacts') {
      api.getJobArtifacts(selectedJobId).then((r) => setArtifacts(r.items || [])).catch(() => setArtifacts([]))
    }
  }, [selectedJobId, subTab])

  const handleReset = async () => {
    if (!resetPass) return notify('Informe a senha de reset de logs.')
    try {
      await api.resetLogs(resetPass)
      notify('Logs resetados com sucesso.')
      setResetPass('')
      onRefresh()
    } catch (err) {
      notify(`Falha ao resetar: ${err.message}`)
    }
  }

  return (
    <div className="stack">
      {/* Métricas */}
      <div className="metrics-row">
        <div className="metric-box">
          <span>Total de lotes</span>
          <strong>{summary?.total_jobs ?? jobs.length}</strong>
        </div>
        <div className="metric-box">
          <span style={{ color: 'var(--ok)' }}>Concluídos com sucesso</span>
          <strong style={{ color: 'var(--ok)' }}>{summary?.success_jobs ?? 0}</strong>
        </div>
        <div className="metric-box">
          <span style={{ color: 'var(--bad)' }}>Com falha</span>
          <strong style={{ color: 'var(--bad)' }}>{summary?.error_jobs ?? 0}</strong>
        </div>
        <div className="metric-box">
          <span style={{ color: 'var(--accent)' }}>Em execução</span>
          <strong style={{ color: 'var(--accent)' }}>{summary?.running_jobs ?? 0}</strong>
        </div>
      </div>

      {/* Auditoria */}
      <div className="card">
        <div className="card-heading">
          <h2>Inspeção de lote</h2>
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            style={{ fontSize: '12px' }}
          >
            {jobs.map((j) => (
              <option key={j.id || j.job_id} value={j.job_id || j.id}>
                {j.job_id || j.id} ({j.filename || 'Arquivo'})
              </option>
            ))}
          </select>
        </div>

        {/* Sub-abas */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
          {[
            ['steps', 'Etapas (Steps)'],
            ['actions', 'Ações (Actions)'],
            ['browser', 'Logs do Navegador'],
            ['artifacts', 'Artefatos & Gravações'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={subTab === id ? 'primary' : ''}
              style={{ fontSize: '11px', padding: '5px 10px' }}
              onClick={() => setSubTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="table-wrapper">
          {subTab === 'steps' && (
            <table>
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Status</th>
                  <th>Mensagem</th>
                  <th>Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {steps.length > 0 ? (
                  steps.map((s, i) => (
                    <tr key={i}>
                      <td><b>{s.step || s.nome}</b></td>
                      <td><StatusIndicator status={s.status} /></td>
                      <td>{s.message || s.detalhes || '—'}</td>
                      <td>{formatIsoForDisplay(s.timestamp || s.created_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: '18px' }}>
                      Nenhuma etapa registrada para este lote.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {subTab === 'actions' && (
            <table>
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Seletor / Alvo</th>
                  <th>Resultado</th>
                  <th>Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {actions.length > 0 ? (
                  actions.map((a, i) => (
                    <tr key={i}>
                      <td>{a.action || a.tipo}</td>
                      <td className="mono">{a.target || a.seletor || '—'}</td>
                      <td>{a.status || 'OK'}</td>
                      <td>{formatIsoForDisplay(a.created_at || a.timestamp)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: '18px' }}>
                      Nenhuma ação capturada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {subTab === 'browser' && (
            <table>
              <thead>
                <tr>
                  <th>Nível</th>
                  <th>Mensagem do console</th>
                  <th>Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {browserLogs.length > 0 ? (
                  browserLogs.map((b, i) => (
                    <tr key={i}>
                      <td><span className="mono" style={{ color: b.level === 'error' ? 'var(--bad)' : 'inherit' }}>{b.level || 'INFO'}</span></td>
                      <td className="mono">{b.text || b.message}</td>
                      <td>{formatIsoForDisplay(b.timestamp)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--muted)', padding: '18px' }}>
                      Nenhum log de console registrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {subTab === 'artifacts' && (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tipo</th>
                  <th>Data</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.length > 0 ? (
                  artifacts.map((art) => (
                    <tr key={art.id}>
                      <td className="mono">{art.id}</td>
                      <td>{art.type || 'screenshot'}</td>
                      <td>{formatIsoForDisplay(art.created_at)}</td>
                      <td>
                        <a
                          href={api.getArtifactDownloadUrl(art.id)}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
                        >
                          Baixar arquivo ↗
                        </a>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: '18px' }}>
                      Nenhum artefato disponível.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Limpeza de Logs */}
      <div className="card">
        <h2>Limpeza e reset de logs</h2>
        <p className="subtitle" style={{ marginBottom: '12px' }}>
          Remove o histórico e artefatos acumulados. Requer a senha configurada no servidor.
        </p>
        <div style={{ display: 'flex', gap: '8px', maxWidth: '420px' }}>
          <input
            type="password"
            placeholder="Senha de segurança"
            value={resetPass}
            onChange={(e) => setResetPass(e.target.value)}
          />
          <button type="button" className="danger" onClick={handleReset}>
            Resetar logs
          </button>
        </div>
      </div>
    </div>
  )
}
