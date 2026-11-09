import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from './services/api.js'
import { templateConfig as cfg } from './template.config.js'
import logoIcon from './assets/logtudo_icon.jpg'

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

  useEffect(() => {
    refreshHistory()
    refreshAdmin()
  }, [])

  const refreshHistory = async () => {
    try {
      const res = await api.listJobs()
      setJobsHistory(res.jobs || [])
    } catch {}
  }

  const refreshAdmin = async () => {
    try {
      const s = await api.getAdminSummary()
      setAdminSummary(s)
    } catch {}
  }

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
          }))
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

  // Auto-scroll do terminal
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // Upload com pré-validação
  const handleFileUpload = async (file) => {
    if (!file) return
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

  // Iniciar execução
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
      {/* Barra Lateral */}
      <aside>
        <div className="brand">
          <img src={logoIcon} alt="Logtudo Logo" className="brand-logo-img" />
          <div className="brand-info">
            <b>{cfg.brand.organization}</b>
            <small>{cfg.brand.product}</small>
          </div>
        </div>

        <nav>
          <button
            type="button"
            className={tab === 'execution' ? 'active' : ''}
            onClick={() => setTab('execution')}
          >
            Execução
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
            Auditoria & Admin
          </button>
          <a
            className="nav-link-btn"
            href={`${api.prefix}/manual-de-uso`}
            target="_blank"
            rel="noreferrer"
          >
            Manual de Uso ↗
          </a>
        </nav>

        {/* Widget do Lote Ativo */}
        <div className="job-widget">
          <span className="job-widget-title">Lote ativo</span>
          {activeJob ? (
            <>
              <div className="job-widget-id" title={activeJob.task_id || activeJob.id}>
                {String(activeJob.job_id || activeJob.id).slice(0, 18)}
              </div>
              <div className="progress-line">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round((activeJob.percent || 0) * 100)}%` }}
                />
              </div>
              <StatusIndicator status={activeJob.status} />
            </>
          ) : (
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Nenhum lote selecionado
            </span>
          )}
        </div>

        <footer>
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Escuro'}
          </button>
        </footer>
      </aside>

      {/* Conteúdo Principal */}
      <main>
        <header className="topbar">
          <div>
            <h1>
              {tab === 'execution' && 'Execução da Automação'}
              {tab === 'history' && 'Histórico de Execuções'}
              {tab === 'admin' && 'Auditoria & Administração'}
            </h1>
            <p className="subtitle">
              {tab === 'execution' && 'Validação prévia de lote e processamento no portal Logtudo.'}
              {tab === 'history' && 'Rastreabilidade de lotes anteriores e status de cotação.'}
              {tab === 'admin' && 'Métricas operacionais, artefatos gerados e logs de depuração.'}
            </p>
          </div>
          <div>
            <Link
              to="/v1"
              style={{
                fontSize: '12px',
                color: 'var(--muted)',
                textDecoration: 'none',
                padding: '6px 11px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--surface)',
                fontWeight: 500,
              }}
            >
              <span>Comparar com Versão V1 (Pré-refinamento)</span>
              <span>↗</span>
            </Link>
          </div>
        </header>

        {/* Aba Execução */}
        {tab === 'execution' && (
          <div className="stack">
            {/* Grid Superior: Planilha e Parâmetros */}
            <div className="grid two-col">
              {/* Card 1: Planilha de Entrada */}
              <div className="card">
                <h2>Planilha de cotação</h2>
                <p className="subtitle">{cfg.upload.help}</p>

                <label className="dropzone-clean">
                  <span className="dropzone-icon">↑</span>
                  <span className="dropzone-text">
                    {selectedFile ? selectedFile.name : 'Selecione ou arraste a planilha .xlsx'}
                  </span>
                  <span className="dropzone-hint">
                    {selectedFile ? 'Clique para substituir o arquivo' : 'Formatos aceitos: .xlsx'}
                  </span>
                  <input
                    type="file"
                    accept={cfg.upload.accept}
                    onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  />
                </label>

                {validationReport && (
                  <div className="validation-summary">
                    <div>
                      <strong>{validationReport.filename}</strong>
                      <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '2px' }}>
                        {validationReport.valid_rows_count} linha(s) identificada(s)
                        {validationReport.invalid_rows_count > 0 && ` • ${validationReport.invalid_rows_count} com pendência`}
                      </div>
                    </div>
                    <StatusIndicator status={validationReport.is_valid ? 'SUCCESS' : 'FAILED'} />
                  </div>
                )}
              </div>

              {/* Card 2: Parâmetros */}
              <div className="card">
                <h2>Parâmetros operacionais</h2>
                <p className="subtitle">Defina o tipo de operação e as credenciais de acesso.</p>

                {/* Seletor Segmentado */}
                <div className="segment-selector">
                  {cfg.operations.map((op) => (
                    <button
                      key={op.code}
                      type="button"
                      className={`segment-item ${tipoOperacao === op.code ? 'active' : ''}`}
                      onClick={() => setTipoOperacao(op.code)}
                    >
                      <div className="segment-head">
                        <strong>{op.title}</strong>
                        <span className="segment-badge">{op.tag}</span>
                      </div>
                      <p className="segment-desc">{op.description}</p>
                    </button>
                  ))}
                </div>

                {/* Campos */}
                <div className="form-grid">
                  <div className="field-group">
                    <span>Usuário</span>
                    <input
                      type="text"
                      value={usuario}
                      placeholder="Usuário da plataforma"
                      onChange={(e) => setUsuario(e.target.value)}
                    />
                  </div>

                  <div className="field-group">
                    <span>Senha</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type={showSenha ? 'text' : 'password'}
                        value={senha}
                        placeholder="Senha"
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

                  <div className="field-group">
                    <span>Data da cotação</span>
                    <input
                      type="date"
                      value={dataReferencia}
                      onChange={(e) => setDataReferencia(e.target.value)}
                    />
                  </div>

                  <div className="field-group">
                    <span>Validade</span>
                    <input
                      type="text"
                      disabled
                      value={dataReferencia ? formatDateForApi(dataReferencia) : 'Automática'}
                    />
                  </div>
                </div>

                {/* Ações */}
                <div className="actions-row">
                  <button
                    type="button"
                    className="primary"
                    disabled={isStarting || isJobRunning}
                    onClick={handleStart}
                  >
                    {isStarting ? 'Iniciando…' : 'Iniciar automação'}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={!isJobRunning}
                    onClick={handleStop}
                  >
                    Interromper
                  </button>
                </div>
              </div>
            </div>

            {/* Stepper Minimalista de Fases */}
            <div className="card">
              <div className="card-heading">
                <h2>Fases do processamento</h2>
                <StatusIndicator status={activeJob?.status} />
              </div>

              <div className="phase-tracker">
                {cfg.phases.map((p, idx) => {
                  const currentIdx = Math.max(
                    0,
                    cfg.phases.findIndex((x) => x.id === (activeJob?.current_phase || 'F1'))
                  )
                  const isDone = idx < currentIdx || normalizedActiveStatus === 'COMPLETED'
                  const isCurrent = idx === currentIdx && isJobRunning

                  return (
                    <div
                      key={p.id}
                      className={`phase-node ${isDone ? 'done' : isCurrent ? 'current' : ''}`}
                    >
                      <div className="phase-indicator">
                        <span className="phase-dot" />
                        <span>{p.title}</span>
                      </div>
                      <small>{p.subtitle}</small>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Grid Inferior: Tabela de Itens e Terminal */}
            <div className="grid work-grid">
              {/* Tabela de Itens */}
              <div className="card" style={{ paddingBottom: 0 }}>
                <div className="card-heading">
                  <h2>Registros do lote</h2>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {items.length} item(ns)
                  </span>
                </div>

                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Motorista</th>
                        <th>Placa</th>
                        <th>Frete negociado</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length > 0 ? (
                        items.map((item, idx) => (
                          <tr key={item.id || idx}>
                            <td className="mono">{item.reference || item.numero || `${idx + 1}`}</td>
                            <td>{item.nome || item.nome_motorista || '—'}</td>
                            <td className="mono">{item.placa || '—'}</td>
                            <td>{item.frete_negociado || item.frete_valor || '—'}</td>
                            <td>
                              <StatusIndicator status={item.status || 'PENDING'} />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px' }}>
                            Carregue uma planilha para listar os registros.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Terminal de Logs Sutil */}
              <TerminalComponent logs={logs} logContainerRef={logContainerRef} autoScroll={autoScroll} setAutoScroll={setAutoScroll} />
            </div>
          </div>
        )}

        {/* Aba Histórico */}
        {tab === 'history' && (
          <HistoryTab
            jobs={jobsHistory}
            onOpenJob={openHistoricalJob}
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

function TerminalComponent({ logs, logContainerRef, autoScroll, setAutoScroll }) {
  const [levelFilter, setLevelFilter] = useState('TODOS')

  const filtered = useMemo(() => {
    if (levelFilter === 'TODOS') return logs
    return logs.filter((l) => l.level === levelFilter)
  }, [logs, levelFilter])

  return (
    <div className="terminal-card">
      <div className="terminal-top">
        <span className="terminal-title">Log de eventos</span>
        <div className="terminal-controls">
          <label>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
          >
            <option value="TODOS">Todos os níveis</option>
            <option value="INFO">Apenas INFO</option>
            <option value="SUCCESS">Apenas Sucesso</option>
            <option value="ERROR">Apenas Erros</option>
          </select>
        </div>
      </div>

      <div className="terminal-viewport" ref={logContainerRef}>
        {filtered.length > 0 ? (
          filtered.map((l, i) => (
            <div key={i} className={`log-line ${l.level.toLowerCase()}`}>
              <time>{l.timestamp || '--:--:--'}</time>
              <b>[{l.level}]</b>
              <span>{l.message}</span>
            </div>
          ))
        ) : (
          <div style={{ color: 'var(--muted)', padding: '20px', textAlign: 'center' }}>
            Aguardando eventos da automação…
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryTab({ jobs, onOpenJob, onRefresh }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      const matchSearch =
        search === '' ||
        `${j.id} ${j.job_id} ${j.filename || ''}`.toLowerCase().includes(search.toLowerCase())
      const matchStatus =
        statusFilter === '' || normalizeStatus(j.status) === statusFilter
      return matchSearch && matchStatus
    })
  }, [jobs, search, statusFilter])

  return (
    <div className="stack">
      <div className="card">
        <div className="card-heading">
          <h2>Histórico de lotes</h2>
          <button type="button" onClick={onRefresh} style={{ fontSize: '12px' }}>
            Atualizar
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
          <input
            type="text"
            placeholder="Buscar por lote ou arquivo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos os status</option>
            <option value="COMPLETED">Concluído</option>
            <option value="RUNNING">Em execução</option>
            <option value="FAILED">Falha</option>
            <option value="PENDING">Aguardando</option>
          </select>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Lote / Task ID</th>
                <th>Arquivo</th>
                <th>Operação</th>
                <th>Status</th>
                <th>Início</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? (
                filtered.map((j) => (
                  <tr key={j.id || j.task_id}>
                    <td className="mono" style={{ fontWeight: 500 }}>
                      {j.job_id || j.id}
                    </td>
                    <td>{j.filename || 'Planilha de Cotação'}</td>
                    <td>{j.tipo_operacao || 'D2D'}</td>
                    <td>
                      <StatusIndicator status={j.status} />
                    </td>
                    <td>{formatIsoForDisplay(j.started_at || j.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onOpenJob(j.job_id || j.id || j.task_id)}
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                      >
                        Inspecionar
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px' }}>
                    Nenhum lote registrado.
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
