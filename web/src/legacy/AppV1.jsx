import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api.js'
import { templateConfig as cfg } from '../template.config.js'
import './styles-v1.css'

const LS_KEYS = {
  usuario: 'logtudo_usuario',
  senha: 'logtudo_senha',
  dataReferencia: 'logtudo_data_referencia',
  tipoOperacao: 'logtudo_tipo_operacao',
  theme: 'automation_theme',
}

const statusMap = {
  PENDING: { label: 'Aguardando', tone: '' },
  STARTED: { label: 'Executando', tone: 'ok' },
  RUNNING: { label: 'Executando', tone: 'ok' },
  PAUSED: { label: 'Pausado', tone: 'warn' },
  SUCCESS: { label: 'Concluído', tone: 'ok' },
  COMPLETED: { label: 'Concluído', tone: 'ok' },
  FAILED: { label: 'Falha', tone: 'bad' },
  FAILURE: { label: 'Falha', tone: 'bad' },
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
  if (!isoString) return '-'
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
  const [connected, setConnected] = useState(true)
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
    setTimeout(() => setToastMessage(''), 4000)
  }

  // Checagem de conectividade inicial
  useEffect(() => {
    api.health()
      .then(() => setConnected(true))
      .catch(() => setConnected(false))

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
            timestamp: new Date().toLocaleTimeString(),
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
      } catch (err) {
        // Silencioso em polling
      }
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

  // Manipulador de upload com pré-validação
  const handleFileUpload = async (file) => {
    if (!file) return
    setSelectedFile(file)
    setValidationReport(null)
    try {
      notify('Analisando e validando planilha...')
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
      notify(`Planilha validada: ${report.valid_rows_count} linhas válidas`)
    } catch (err) {
      notify(`Erro ao validar arquivo: ${err.message}`)
    }
  }

  // Iniciar execução do lote
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
        timestamp: new Date().toLocaleTimeString(),
        level: 'INFO',
        phase: 'F1',
        message: 'Iniciando automação com parâmetros configurados...',
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

      let res
      if (jobId && !api.mockMode) {
        res = await api.startJob(jobId, payload)
      } else {
        // Fallback de upload direto se não fez upload prévio pelo id
        notify('Enfileirando job no servidor...')
        res = await api.startJob(jobId || 'new', payload)
      }

      setActiveJob((prev) => ({
        ...prev,
        task_id: res.task_id || prev?.id,
        status: 'RUNNING',
        current_phase: 'F2',
      }))
      notify('Automação iniciada com sucesso!')
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
          timestamp: new Date().toLocaleTimeString(),
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
      notify(`Carregando histórico do lote ${jobId}...`)
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
    <div className={`v1-scope ${theme}`}>
      <div style={{ background: '#1c2432', color: '#93c5fd', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <span>⚠️ Visualizando <strong>Versão V1 (Pré-refinamento: logo LT, terminal escuro, tags IA)</strong></span>
        <Link to="/" style={{ color: '#ffffff', background: '#2563eb', padding: '4px 12px', borderRadius: '4px', textDecoration: 'none', fontWeight: 600 }}>
          ← Alternar para a Versão Refinada (V2)
        </Link>
      </div>
      <div className="shell">
      {/* Barra Lateral de Navegação */}
      <aside>
        <div className="brand">
          <i>LT</i>
          <div className="brand-info">
            <b>{cfg.brand.organization}</b>
            <small>{cfg.brand.product} · v{cfg.brand.version}</small>
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
            Admin & Observabilidade
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

        {/* Card do Lote Ativo */}
        <div className="job-card">
          <small>LOTE ATIVO</small>
          {activeJob ? (
            <>
              <b className="mono" title={activeJob.task_id || activeJob.id}>
                {String(activeJob.job_id || activeJob.id).slice(0, 16)}
              </b>
              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.round((activeJob.percent || 0) * 100)}%` }}
                />
              </div>
              <StatusPill status={activeJob.status} />
            </>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Nenhum lote selecionado
            </span>
          )}
        </div>

        <footer>
          <div className="health-indicator">
            <span className={`health-dot ${connected ? 'online' : ''}`} />
            <span>{connected ? 'API Conectada' : 'API Desconectada'}</span>
          </div>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀️ Tema Claro' : '🌙 Tema Escuro'}
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
              {tab === 'admin' && 'Administração & Observabilidade'}
            </h1>
            <p className="subtitle">
              {tab === 'execution' && 'Upload, validação prévia de planilha e processamento operacional.'}
              {tab === 'history' && 'Registro auditável de lotes executados e status de faturamento.'}
              {tab === 'admin' && 'Diagnóstico completo, métricas de jobs, artefatos e logs do navegador.'}
            </p>
          </div>
          <StatusPill
            status={connected ? 'COMPLETED' : 'FAILED'}
            customText={connected ? 'Sistema Operacional' : 'Reconectando…'}
          />
        </header>

        {/* Aba 1: Execução */}
        {tab === 'execution' && (
          <div className="stack">
            {/* Grid 2 colunas: Preparar e Executar */}
            <div className="grid two-col">
              {/* Card 1: Preparar Planilha */}
              <div className="card">
                <div className="card-heading">
                  <div>
                    <small style={{ color: 'var(--muted)', fontWeight: 700 }}>1 · PREPARAR</small>
                    <h2>{cfg.upload.title}</h2>
                  </div>
                </div>
                <p className="subtitle">{cfg.upload.help}</p>

                <label className="dropzone">
                  <span>{selectedFile ? 'Trocar arquivo selecionado' : 'Selecione ou arraste o arquivo aqui'}</span>
                  <em>{cfg.upload.accept}</em>
                  <input
                    type="file"
                    accept={cfg.upload.accept}
                    onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  />
                </label>

                {validationReport && (
                  <div className={`validation-box ${validationReport.is_valid ? '' : 'error'}`}>
                    <div>
                      <strong>{validationReport.filename}</strong>
                      <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '2px' }}>
                        {validationReport.valid_rows_count} linha(s) válida(s)
                        {validationReport.invalid_rows_count > 0 && ` • ${validationReport.invalid_rows_count} com pendência`}
                      </div>
                    </div>
                    <span className={`pill ${validationReport.is_valid ? 'ok' : 'bad'}`}>
                      {validationReport.is_valid ? 'Validada' : 'Atenção'}
                    </span>
                  </div>
                )}
              </div>

              {/* Card 2: Controles e Parâmetros */}
              <div className="card">
                <div className="card-heading">
                  <div>
                    <small style={{ color: 'var(--muted)', fontWeight: 700 }}>2 · EXECUTAR</small>
                    <h2>Parâmetros Operacionais</h2>
                  </div>
                </div>

                {/* Seletor de Operação */}
                <div className="operation-selector">
                  {cfg.operations.map((op) => (
                    <button
                      key={op.code}
                      type="button"
                      className={`operation-btn ${tipoOperacao === op.code ? 'active' : ''}`}
                      onClick={() => setTipoOperacao(op.code)}
                    >
                      <div className="operation-btn-head">
                        <strong>{op.title}</strong>
                        <span className="operation-tag">{op.tag}</span>
                      </div>
                      <p className="operation-desc">{op.description}</p>
                    </button>
                  ))}
                </div>

                {/* Campos de formulário */}
                <div className="form-fields">
                  <label className="field">
                    <span>Usuário do Portal</span>
                    <input
                      type="text"
                      value={usuario}
                      placeholder="Usuário da plataforma"
                      onChange={(e) => setUsuario(e.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Senha do Portal</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type={showSenha ? 'text' : 'password'}
                        value={senha}
                        placeholder="Senha da plataforma"
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
                  </label>

                  <label className="field">
                    <span>Data da Cotação</span>
                    <input
                      type="date"
                      value={dataReferencia}
                      onChange={(e) => setDataReferencia(e.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>Validade</span>
                    <input
                      type="text"
                      disabled
                      value={dataReferencia ? formatDateForApi(dataReferencia) : 'Automática'}
                    />
                  </label>
                </div>

                {/* Barra de Ações */}
                <div className="actions-bar">
                  <button
                    type="button"
                    className="primary"
                    disabled={isStarting || isJobRunning}
                    onClick={handleStart}
                  >
                    {isStarting ? 'Iniciando…' : 'Iniciar Automação'}
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

            {/* Fases do Processamento (F1 a F5) */}
            <div className="card">
              <div className="card-heading">
                <div>
                  <small style={{ color: 'var(--muted)', fontWeight: 700 }}>ACOMPANHAMENTO</small>
                  <h2>Fases do Processamento</h2>
                </div>
                <StatusPill status={activeJob?.status} />
              </div>

              <div className="steps-container">
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
                      className={`step-item ${isDone ? 'done' : isCurrent ? 'current' : ''}`}
                    >
                      <i>{isDone ? '✓' : idx + 1}</i>
                      <div className="step-text">
                        <b>{p.title}</b>
                        <small>{p.subtitle}</small>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Grid de Itens e Terminal de Logs */}
            <div className="grid work-grid">
              {/* Tabela de Itens */}
              <div className="card" style={{ paddingBottom: 0 }}>
                <div className="card-heading">
                  <div>
                    <small style={{ color: 'var(--muted)', fontWeight: 700 }}>ITENS</small>
                    <h2>Lote em Processamento</h2>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {items.length} registro(s)
                  </span>
                </div>

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Nº / Ref</th>
                        <th>Motorista</th>
                        <th>Placa</th>
                        <th>Frete Negociado</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length > 0 ? (
                        items.map((item, idx) => (
                          <tr key={item.id || idx}>
                            <td className="mono">{item.reference || item.numero || `Linha ${idx + 1}`}</td>
                            <td>{item.nome || item.nome_motorista || '—'}</td>
                            <td className="mono">{item.placa || '—'}</td>
                            <td>{item.frete_negociado || item.frete_valor || '—'}</td>
                            <td>
                              <StatusPill status={item.status || 'PENDING'} />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px' }}>
                            Carregue uma planilha para inspecionar os itens.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Terminal de Logs ao Vivo */}
              <Terminal logs={logs} logContainerRef={logContainerRef} autoScroll={autoScroll} setAutoScroll={setAutoScroll} />
            </div>
          </div>
        )}

        {/* Aba 2: Histórico */}
        {tab === 'history' && (
          <HistoryTab
            jobs={jobsHistory}
            onOpenJob={openHistoricalJob}
            onRefresh={refreshHistory}
          />
        )}

        {/* Aba 3: Admin & Observabilidade */}
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

      {/* Notificação Toast */}
      {toastMessage && (
        <div className="toast" onClick={() => setToastMessage('')}>
          {toastMessage}
        </div>
      )}
    </div>
  </div>
  )
}

function StatusPill({ status, customText }) {
  const norm = normalizeStatus(status)
  const meta = statusMap[norm] || { label: status || 'Aguardando', tone: '' }
  return (
    <span className={`pill ${meta.tone}`}>
      {customText || meta.label}
    </span>
  )
}

function Terminal({ logs, logContainerRef, autoScroll, setAutoScroll }) {
  const [levelFilter, setLevelFilter] = useState('TODOS')

  const filtered = useMemo(() => {
    if (levelFilter === 'TODOS') return logs
    return logs.filter((l) => l.level === levelFilter)
  }, [logs, levelFilter])

  return (
    <div className="terminal">
      <div className="terminal-header">
        <div>
          <small style={{ color: 'var(--muted)', fontWeight: 700 }}>LOG AO VIVO</small>
          <div style={{ fontWeight: 600, fontSize: '13px' }}>Terminal de Eventos</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted)' }}>
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
            style={{ fontSize: '11px', padding: '4px 8px' }}
          >
            <option value="TODOS">Todos os níveis</option>
            <option value="INFO">Apenas INFO</option>
            <option value="SUCCESS">Apenas SUCESSO</option>
            <option value="ERROR">Apenas ERROS</option>
          </select>
        </div>
      </div>

      <div className="terminal-body" ref={logContainerRef}>
        {filtered.length > 0 ? (
          filtered.map((l, i) => (
            <div key={i} className={`terminal-row ${l.level.toLowerCase()}`}>
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
          <div>
            <small style={{ color: 'var(--muted)', fontWeight: 700 }}>RASTREABILIDADE</small>
            <h2>Histórico Geral de Jobs</h2>
          </div>
          <button type="button" onClick={onRefresh} style={{ fontSize: '12px' }}>
            Atualizar Lista
          </button>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Buscar por lote, task_id ou arquivo…"
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
            <option value="RUNNING">Executando</option>
            <option value="FAILED">Falha</option>
            <option value="PENDING">Aguardando</option>
          </select>
        </div>

        <div className="table-scroll">
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
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {j.job_id || j.id}
                    </td>
                    <td>{j.filename || 'Planilha de Cotação'}</td>
                    <td>{j.tipo_operacao || 'D2D'}</td>
                    <td>
                      <StatusPill status={j.status} />
                    </td>
                    <td>{formatIsoForDisplay(j.started_at || j.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onOpenJob(j.job_id || j.id || j.task_id)}
                        style={{ padding: '4px 10px', fontSize: '11px' }}
                      >
                        Inspecionar
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px' }}>
                    Nenhum lote registrado até o momento.
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
      notify('Logs resetados com sucesso!')
      setResetPass('')
      onRefresh()
    } catch (err) {
      notify(`Falha ao resetar: ${err.message}`)
    }
  }

  return (
    <div className="stack">
      {/* Indicadores Principais */}
      <div className="stats-grid">
        <div className="stat-card">
          <span>Total de Lotes</span>
          <strong>{summary?.total_jobs ?? jobs.length}</strong>
        </div>
        <div className="stat-card" style={{ borderColor: 'rgba(34, 197, 94, 0.4)' }}>
          <span style={{ color: 'var(--ok)' }}>Concluídos com Sucesso</span>
          <strong style={{ color: 'var(--ok)' }}>{summary?.success_jobs ?? 0}</strong>
        </div>
        <div className="stat-card" style={{ borderColor: 'rgba(239, 68, 68, 0.4)' }}>
          <span style={{ color: 'var(--bad)' }}>Com Falha</span>
          <strong style={{ color: 'var(--bad)' }}>{summary?.error_jobs ?? 0}</strong>
        </div>
        <div className="stat-card" style={{ borderColor: 'rgba(37, 99, 235, 0.4)' }}>
          <span style={{ color: 'var(--accent)' }}>Em Execução</span>
          <strong style={{ color: 'var(--accent)' }}>{summary?.running_jobs ?? 0}</strong>
        </div>
      </div>

      {/* Auditoria Profunda do Job */}
      <div className="card">
        <div className="card-heading">
          <div>
            <small style={{ color: 'var(--muted)', fontWeight: 700 }}>DIAGNÓSTICO E AUDITORIA</small>
            <h2>Inspeção de Lote</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
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
        </div>

        {/* Sub-navegação do admin */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
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
              style={{ fontSize: '11px', padding: '6px 12px' }}
              onClick={() => setSubTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="table-scroll">
          {subTab === 'steps' && (
            <table>
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Status</th>
                  <th>Mensagem</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {steps.length > 0 ? (
                  steps.map((s, i) => (
                    <tr key={i}>
                      <td><b>{s.step || s.nome}</b></td>
                      <td><StatusPill status={s.status} /></td>
                      <td>{s.message || s.detalhes || '—'}</td>
                      <td>{formatIsoForDisplay(s.timestamp || s.created_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
                      Nenhuma etapa detalhada registrada para este lote.
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
                  <th>Alvo / Seletor</th>
                  <th>Resultado</th>
                  <th>Timestamp</th>
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
                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
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
                  <th>Mensagem do Console</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {browserLogs.length > 0 ? (
                  browserLogs.map((b, i) => (
                    <tr key={i}>
                      <td><span className={`pill ${b.level === 'error' ? 'bad' : ''}`}>{b.level || 'INFO'}</span></td>
                      <td className="mono">{b.text || b.message}</td>
                      <td>{formatIsoForDisplay(b.timestamp)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
                      Nenhum log de console do navegador registrado.
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
                  <th>Download</th>
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
                          style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                        >
                          Baixar Arquivo ↗
                        </a>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
                      Nenhum artefato gerado para este lote.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Painel de Manutenção / Reset */}
      <div className="card">
        <small style={{ color: 'var(--muted)', fontWeight: 700 }}>MANUTENÇÃO</small>
        <h2>Limpeza e Reset de Logs</h2>
        <p className="subtitle" style={{ marginBottom: '14px' }}>
          Remove o histórico e artefatos acumulados no SQLite e arquivos temporários. Requer a senha configurada no servidor.
        </p>
        <div style={{ display: 'flex', gap: '10px', maxWidth: '500px' }}>
          <input
            type="password"
            placeholder="Senha de segurança"
            value={resetPass}
            onChange={(e) => setResetPass(e.target.value)}
          />
          <button type="button" className="danger" onClick={handleReset}>
            Resetar Logs
          </button>
        </div>
      </div>
    </div>
  )
}
