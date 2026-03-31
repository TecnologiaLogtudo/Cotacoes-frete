import React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

const LS_KEYS = {
  usuario: 'logtudo_usuario',
  senha: 'logtudo_senha',
  dataReferencia: 'logtudo_data_referencia',
}

const API_BASE = import.meta.env.BASE_URL
const apiUrl = (path) => `${API_BASE}api${path.startsWith('/') ? path : `/${path}`}`

function statusClass(status) {
  if (status === 'SUCCESS') return 'badge success'
  if (status === 'FAILURE') return 'badge error'
  if (status === 'STARTED') return 'badge running'
  return 'badge pending'
}

function logTone(line) {
  const norm = line.toLowerCase()
  if (norm.includes('erro') || norm.includes('traceback') || norm.includes('exception')) return 'error'
  if (norm.includes('conclu') || norm.includes('sucesso')) return 'success'
  if (norm.includes('processando linha')) return 'running'
  return 'info'
}

function statusLabel(status) {
  if (status === 'SUCCESS') return 'Concluído'
  if (status === 'FAILURE') return 'Falha'
  if (status === 'STARTED') return 'Executando'
  if (status === 'PENDING') return 'Enfileirado'
  return 'Aguardando'
}

function formatDateForApi(isoDate) {
  if (!isoDate || !isoDate.includes('-')) return isoDate || ''
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

function formatDateForUi(isoDate) {
  if (!isoDate || !isoDate.includes('-')) return '-'
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false })
}

export default function App() {
  const [usuario, setUsuario] = useState(localStorage.getItem(LS_KEYS.usuario) || '')
  const [senha, setSenha] = useState(localStorage.getItem(LS_KEYS.senha) || '')
  const [dataReferencia, setDataReferencia] = useState(localStorage.getItem(LS_KEYS.dataReferencia) || '')
  const [planilha, setPlanilha] = useState(null)

  const [taskId, setTaskId] = useState('')
  const [jobStatus, setJobStatus] = useState('IDLE')
  const [processedLines, setProcessedLines] = useState(0)
  const [totalLines, setTotalLines] = useState(null)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeView, setActiveView] = useState('processamento')
  const [showSenha, setShowSenha] = useState(false)
  const [lastUpdate, setLastUpdate] = useState('-')

  const logsRef = useRef(null)
  const cursorRef = useRef(0)

  useEffect(() => localStorage.setItem(LS_KEYS.usuario, usuario), [usuario])
  useEffect(() => localStorage.setItem(LS_KEYS.senha, senha), [senha])
  useEffect(() => localStorage.setItem(LS_KEYS.dataReferencia, dataReferencia), [dataReferencia])

  useEffect(() => {
    if (!taskId) return
    const timer = setInterval(async () => {
      await Promise.all([pollStatus(taskId), pollLogs(taskId)])
      setLastUpdate(nowTimeLabel())
    }, 2000)
    return () => clearInterval(timer)
  }, [taskId])

  useEffect(() => {
    if (autoScroll && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  async function pollStatus(id) {
    try {
      const resp = await fetch(apiUrl(`/jobs/${id}`))
      if (!resp.ok) return
      const data = await resp.json()
      setJobStatus(data.status)
      setProcessedLines(data.processed_lines || 0)
      setTotalLines(data.total_lines ?? null)
      if (data.error) setError(String(data.error))
    } catch {
      // silencioso no polling
    }
  }

  async function pollLogs(id) {
    try {
      const resp = await fetch(apiUrl(`/jobs/${id}/logs?cursor=${cursorRef.current}`))
      if (!resp.ok) return
      const data = await resp.json()
      if (Array.isArray(data.lines) && data.lines.length > 0) {
        setLogs((prev) => [...prev, ...data.lines])
      }
      cursorRef.current = data.next_cursor ?? cursorRef.current
    } catch {
      // silencioso no polling
    }
  }

  async function startProcessing() {
    setError('')

    if (!planilha) {
      setError('Selecione uma planilha .xlsx para iniciar.')
      return
    }

    if (!usuario || !senha || !dataReferencia) {
      setError('Preencha usuário, senha e data da cotação.')
      return
    }

    setIsSubmitting(true)
    setLogs([])
    setTaskId('')
    setJobStatus('PENDING')
    setProcessedLines(0)
    setTotalLines(null)
    cursorRef.current = 0
    setLastUpdate(nowTimeLabel())

    try {
      const form = new FormData()
      form.append('usuario', usuario)
      form.append('senha', senha)
      form.append('data_referencia', formatDateForApi(dataReferencia))
      form.append('validade', formatDateForApi(dataReferencia))
      form.append('planilha', planilha)

      const resp = await fetch(apiUrl('/jobs/cotacoes'), {
        method: 'POST',
        body: form,
      })

      const data = await resp.json()
      if (!resp.ok) {
        setError(data.detail || 'Falha ao criar job.')
        setJobStatus('FAILURE')
        return
      }

      setTaskId(data.task_id)
      setJobStatus(data.status || 'PENDING')
    } catch (err) {
      setError(String(err))
      setJobStatus('FAILURE')
    } finally {
      setIsSubmitting(false)
    }
  }

  const progressText = useMemo(() => {
    if (totalLines == null) return `${processedLines} linha(s) processada(s)`
    return `${processedLines}/${totalLines} linha(s)`
  }, [processedLines, totalLines])

  const progressPct = useMemo(() => {
    if (!totalLines || totalLines <= 0) return 0
    return Math.min(100, Math.round((processedLines / totalLines) * 100))
  }, [processedLines, totalLines])

  const enfileirado = jobStatus === 'PENDING' ? 'Sim' : 'Não'
  const dataAplicada = formatDateForUi(dataReferencia)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">LT</div>
          <div>
            <div className="brand-title">LogTudo</div>
            <div className="brand-subtitle">Faturamentos adicionais v1</div>
          </div>
        </div>

        <nav className="nav">
          <button type="button" className={`nav-btn ${activeView === 'processamento' ? 'active' : ''}`} onClick={() => setActiveView('processamento')}>Processamento</button>
          <button type="button" className={`nav-btn ${activeView === 'logs' ? 'active' : ''}`} onClick={() => setActiveView('logs')}>Logs</button>
          <a className="nav-btn nav-link" href="/cotacoes/manual-de-uso" target="_blank" rel="noreferrer">Manual</a>
        </nav>

        <div className="sidebar-footer">
          <div className="status-pill">Status atual: {statusLabel(jobStatus)}</div>
          <div className="status-pill secondary">Data da cotação: {dataAplicada}</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Faturamentos adicionais</h1>
            <p>Operação central com logs em tempo real.</p>
          </div>
        </header>

        {activeView === 'processamento' && (
          <>
            <div className="grid two-col">
              <article className="card muted">
                <div className="card-header">
                  <h2>Parâmetros de Execução</h2>
                </div>
                <div className="card-body form-grid single-col-form">
                  <label className="field">
                    <span>Usuário</span>
                    <input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuário Ravex" />
                  </label>

                  <label className="field">
                    <span>Senha</span>
                    <div className="password-row">
                      <input
                        type={showSenha ? 'text' : 'password'}
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)}
                        placeholder="Senha Ravex"
                      />
                      <button type="button" className="btn ghost password-toggle" onClick={() => setShowSenha((v) => !v)}>
                        {showSenha ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </div>
                  </label>

                  <label className="field">
                    <span>Data da cotação</span>
                    <input type="date" value={dataReferencia} onChange={(e) => setDataReferencia(e.target.value)} />
                  </label>

                  <div className="field">
                    <span>Selecionar arquivo</span>
                    <label className="file-upload">
                      <input type="file" accept=".xlsx" onChange={(e) => setPlanilha(e.target.files?.[0] || null)} />
                      <strong>{planilha ? 'Trocar planilha' : 'Selecionar planilha'}</strong>
                    </label>
                  </div>

                  <div className="file-meta">
                    <div className="file-name-row">
                      <span>{planilha ? planilha.name : 'Nenhuma planilha carregada'}</span>
                      {planilha && (
                        <button type="button" className="file-reset" aria-label="Remover arquivo" onClick={() => setPlanilha(null)}>
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>

              <article className="card muted">
                <div className="card-header">
                  <h2>Resumo Operacional</h2>
                  <span className={statusClass(jobStatus)}>{statusLabel(jobStatus)}</span>
                </div>
                <div className="card-body">
                  <div className="summary-line">
                    <strong>Andamento</strong>
                    <span>Enfileirados: {enfileirado}</span>
                  </div>

                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${progressPct}%` }} />
                  </div>

                  <div className="summary-stats">
                    <div><strong>Total previsto</strong><span>{totalLines ?? '-'}</span></div>
                    <div><strong>Linhas processadas</strong><span>{processedLines}</span></div>
                    <div><strong>Data aplicada</strong><span>{dataAplicada}</span></div>
                  </div>

                  <div className="summary-bottom">
                    <div><strong>Task ID</strong><span>{taskId || '-'}</span></div>
                    <div><strong>Atualização a cada 2 segundos</strong><span>{lastUpdate}</span></div>
                  </div>

                  <div className="progress-meta">
                    <span>{progressText}</span>
                    <span>{error || 'Aguardando execução'}</span>
                  </div>
                </div>
              </article>
            </div>

            <article className="card logs-card">
              <div className="card-header execution-header">
                <h2>Execução e Logs</h2>
                <div className="execution-controls">
                  <button type="button" className="btn primary" disabled={isSubmitting} onClick={startProcessing}>
                    {isSubmitting ? 'Iniciando...' : 'Iniciar'}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      setTaskId('')
                      setJobStatus('IDLE')
                    }}
                  >
                    Parar
                  </button>
                  <div className="toggle-row compact">
                    <label className="switch">
                      <input type="checkbox" checked={autoScroll} onChange={() => setAutoScroll((v) => !v)} />
                      <span className="slider" />
                    </label>
                    <span>Executar com auto-scroll</span>
                  </div>
                </div>
              </div>

              <div className="card-body log-body" ref={logsRef}>
                {logs.length === 0 && <div className="log-entry"><span>-</span><span className="level">INFO</span><span>Sem logs ainda.</span></div>}
                {logs.map((line, idx) => {
                  const tone = logTone(line)
                  const level = tone === 'error' ? 'ERROR' : tone === 'success' ? 'SUCCESS' : tone === 'running' ? 'RUNNING' : 'INFO'
                  return (
                    <div key={`${idx}-${line.slice(0, 16)}`} className={`log-entry ${tone}`}>
                      <span>{String(idx + 1).padStart(3, '0')}</span>
                      <span className="level">{level}</span>
                      <span>{line}</span>
                    </div>
                  )
                })}
              </div>
            </article>
          </>
        )}

        {activeView === 'logs' && (
          <article className="card logs-card">
            <div className="card-header">
              <h2>Logs</h2>
            </div>
            <div className="card-body log-body" ref={logsRef}>
              {logs.length === 0 && <div className="log-entry"><span>-</span><span className="level">INFO</span><span>Sem logs ainda.</span></div>}
              {logs.map((line, idx) => {
                const tone = logTone(line)
                const level = tone === 'error' ? 'ERROR' : tone === 'success' ? 'SUCCESS' : tone === 'running' ? 'RUNNING' : 'INFO'
                return (
                  <div key={`full-${idx}-${line.slice(0, 16)}`} className={`log-entry ${tone}`}>
                    <span>{String(idx + 1).padStart(3, '0')}</span>
                    <span className="level">{level}</span>
                    <span>{line}</span>
                  </div>
                )
              })}
            </div>
          </article>
        )}
      </main>
    </div>
  )
}
