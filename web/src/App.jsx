import React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

const LS_KEYS = {
  usuario: 'logtudo_usuario',
  senha: 'logtudo_senha',
  dataReferencia: 'logtudo_data_referencia',
  validade: 'logtudo_validade',
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

function logLabel(status) {
  if (status === 'SUCCESS') return 'Concluído'
  if (status === 'FAILURE') return 'Falha'
  if (status === 'STARTED') return 'Executando'
  if (status === 'PENDING') return 'Em fila'
  return 'Aguardando'
}

export default function App() {
  const [usuario, setUsuario] = useState(localStorage.getItem(LS_KEYS.usuario) || '')
  const [senha, setSenha] = useState(localStorage.getItem(LS_KEYS.senha) || '')
  const [dataReferencia, setDataReferencia] = useState(localStorage.getItem(LS_KEYS.dataReferencia) || '')
  const [validade, setValidade] = useState(localStorage.getItem(LS_KEYS.validade) || '')
  const [planilha, setPlanilha] = useState(null)

  const [taskId, setTaskId] = useState('')
  const [jobStatus, setJobStatus] = useState('IDLE')
  const [processedLines, setProcessedLines] = useState(0)
  const [totalLines, setTotalLines] = useState(null)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const [cursor, setCursor] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeView, setActiveView] = useState('processamento')
  const [logFilter, setLogFilter] = useState('all')

  const logsRef = useRef(null)

  useEffect(() => localStorage.setItem(LS_KEYS.usuario, usuario), [usuario])
  useEffect(() => localStorage.setItem(LS_KEYS.senha, senha), [senha])
  useEffect(() => localStorage.setItem(LS_KEYS.dataReferencia, dataReferencia), [dataReferencia])
  useEffect(() => localStorage.setItem(LS_KEYS.validade, validade), [validade])

  useEffect(() => {
    if (!taskId) return
    const timer = setInterval(async () => {
      await Promise.all([pollStatus(taskId), pollLogs(taskId)])
    }, 2000)
    return () => clearInterval(timer)
  }, [taskId, cursor])

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
      const resp = await fetch(apiUrl(`/jobs/${id}/logs?cursor=${cursor}`))
      if (!resp.ok) return
      const data = await resp.json()
      if (Array.isArray(data.lines) && data.lines.length > 0) {
        setLogs((prev) => [...prev, ...data.lines])
      }
      setCursor(data.next_cursor || cursor)
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

    setIsSubmitting(true)
    setLogs([])
    setCursor(0)
    setTaskId('')
    setJobStatus('PENDING')
    setProcessedLines(0)
    setTotalLines(null)

    try {
      const form = new FormData()
      form.append('usuario', usuario)
      form.append('senha', senha)
      form.append('data_referencia', dataReferencia)
      form.append('validade', validade)
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

  const totalLogLines = logs.length
  const progressPct = useMemo(() => {
    if (!totalLines || totalLines <= 0) return 0
    return Math.min(100, Math.round((processedLines / totalLines) * 100))
  }, [processedLines, totalLines])

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logs
    return logs.filter((line) => logTone(line) === logFilter)
  }, [logs, logFilter])

  const previewRows = useMemo(() => logs.slice(0, 6), [logs])

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
          <button type="button" className={`nav-btn ${activeView === 'configuracoes' ? 'active' : ''}`} onClick={() => setActiveView('configuracoes')}>Configurações</button>
          <button type="button" className={`nav-btn ${activeView === 'resultados' ? 'active' : ''}`} onClick={() => setActiveView('resultados')}>Resultados</button>
          <div className="nav-divider" />
          <button type="button" className="nav-btn">Manual do Usuário</button>
          <button type="button" className="nav-btn">Logs</button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-pill">{taskId ? `Task: ${taskId.slice(0, 10)}...` : 'Sem task ativa'}</div>
          <div className="status-pill secondary">Disconnected</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Faturamentos adicionais</h1>
            <p>Operação central com logs em tempo real.</p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="btn ghost" onClick={() => setActiveView('resultados')}>Mostrar Logs</button>
            <button type="button" className="btn primary" disabled={isSubmitting} onClick={startProcessing}>
              {isSubmitting ? 'Iniciando...' : 'Iniciar'}
            </button>
          </div>
        </header>

        <section className={`view ${activeView === 'processamento' ? 'active' : ''}`}>
          <div className="grid two-col">
            <article className="card muted">
              <div className="card-header">
                <h2>Arquivo</h2>
                <span className="badge">{planilha ? planilha.name : 'Nenhum arquivo'}</span>
              </div>
              <div className="card-body">
                <label className="file-upload">
                  <input type="file" accept=".xlsx" onChange={(e) => setPlanilha(e.target.files?.[0] || null)} />
                  <strong>{planilha ? 'Trocar planilha' : 'Selecionar planilha'}</strong>
                </label>
                <div className="file-meta">
                  <div className="file-name-row">
                    <span>{planilha ? planilha.name : '-'}</span>
                    {planilha && (
                      <button type="button" className="file-reset" aria-label="Remover arquivo" onClick={() => setPlanilha(null)}>
                        ×
                      </button>
                    )}
                  </div>
                  <span>{totalLines ?? 0} linhas, {previewRows.length} em prévia</span>
                </div>
              </div>
            </article>

            <article className="card muted">
              <div className="card-header">
                <h2>Mapeamento</h2>
                <span className="badge ghost">Obrigatório</span>
              </div>
              <div className="card-body mapping-grid">
                <label className="field">
                  <span>Login</span>
                  <input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuário Ravex" />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha Ravex" />
                </label>
                <label className="field">
                  <span>Data Cotação</span>
                  <input value={dataReferencia} onChange={(e) => setDataReferencia(e.target.value)} placeholder="dd/mm/aaaa" />
                </label>
                <label className="field">
                  <span>Validade</span>
                  <input value={validade} onChange={(e) => setValidade(e.target.value)} placeholder="dd/mm/aaaa" />
                </label>
                <label className="field">
                  <span>Status</span>
                  <input value={logLabel(jobStatus)} readOnly />
                </label>
                <label className="field">
                  <span>Task ID</span>
                  <input value={taskId || '-'} readOnly />
                </label>
              </div>
            </article>
          </div>

          <article className="card">
            <div className="card-header">
              <h2>Pré-visualização</h2>
              <span className="badge">{totalLines ?? 0} linhas</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Evento</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 && (
                    <tr>
                      <td colSpan={2}>Sem dados de prévia ainda.</td>
                    </tr>
                  )}
                  {previewRows.map((line, idx) => (
                    <tr key={`preview-${idx}-${line.slice(0, 10)}`}>
                      <td>{idx + 1}</td>
                      <td>{line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card">
            <div className="card-header">
              <h2>Controle</h2>
              <span className="badge">{progressPct}%</span>
            </div>
            <div className="card-body">
              <div className="toggle-row">
                <label className="switch">
                  <input type="checkbox" checked={autoScroll} onChange={() => setAutoScroll((v) => !v)} />
                  <span className="slider" />
                </label>
                <span>Executar com auto-scroll</span>
              </div>

              <div className="control-buttons">
                <button type="button" className="btn primary" disabled={isSubmitting} onClick={startProcessing}>
                  {isSubmitting ? 'Iniciando...' : 'Iniciar'}
                </button>
                <button type="button" className="btn ghost" disabled>
                  Pausar
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
              </div>

              <div className="progress">
                <div className="progress-bar" style={{ width: `${progressPct}%` }} />
              </div>

              <div className="progress-meta">
                <span>{progressText}</span>
                <span>{error || `NF: ${totalLines ?? 'N/A'}`}</span>
              </div>
            </div>
          </article>

          <article className="card logs-card">
            <div className="card-header">
              <h2>Logs ao vivo</h2>
              <div className="log-controls">
                <select value={logFilter} onChange={(e) => setLogFilter(e.target.value)}>
                  <option value="all">Todos</option>
                  <option value="info">Info</option>
                  <option value="running">Execução</option>
                  <option value="success">Sucesso</option>
                  <option value="error">Erro</option>
                </select>
                <button type="button" className="btn ghost" onClick={() => setLogs([])}>Limpar</button>
                <label className="checkbox">
                  <input type="checkbox" checked={autoScroll} onChange={() => setAutoScroll((v) => !v)} />
                  Auto-scroll
                </label>
              </div>
            </div>
            <div className="card-body log-body" ref={logsRef}>
              {filteredLogs.length === 0 && <div className="log-entry"><span>-</span><span className="level">INFO</span><span>Sem logs ainda.</span></div>}
              {filteredLogs.map((line, idx) => {
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
        </section>

        <section className={`view ${activeView === 'configuracoes' ? 'active' : ''}`}>
          <div className="grid single">
            <article className="card">
              <div className="card-header">
                <h2>Configurações do Processo</h2>
              </div>
              <div className="card-body form-grid">
                <label className="field">
                  <span>Usuário</span>
                  <input value={usuario} onChange={(e) => setUsuario(e.target.value)} />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
                </label>
                <label className="field">
                  <span>Data de Cotação</span>
                  <input value={dataReferencia} onChange={(e) => setDataReferencia(e.target.value)} />
                </label>
                <label className="field">
                  <span>Validade</span>
                  <input value={validade} onChange={(e) => setValidade(e.target.value)} />
                </label>
              </div>
              <div className="card-footer">
                <button type="button" className="btn primary" disabled={isSubmitting} onClick={startProcessing}>
                  {isSubmitting ? 'Iniciando...' : 'Salvar e iniciar'}
                </button>
              </div>
            </article>
          </div>
        </section>

        <section className={`view ${activeView === 'resultados' ? 'active' : ''}`}>
          <div className="grid two-col">
            <article className="card summary-card">
              <h3>Status</h3>
              <div className="summary-value">{logLabel(jobStatus)}</div>
            </article>
            <article className="card summary-card">
              <h3>Linhas processadas</h3>
              <div className="summary-value">{processedLines}</div>
            </article>
          </div>
          <article className="card logs-card">
            <div className="card-header">
              <h2>Histórico de Logs</h2>
            </div>
            <div className="card-body log-body">
              {logs.length === 0 && <div className="log-entry"><span>-</span><span className="level">INFO</span><span>Nenhum log registrado.</span></div>}
              {logs.map((line, idx) => {
                const tone = logTone(line)
                const level = tone === 'error' ? 'ERROR' : tone === 'success' ? 'SUCCESS' : tone === 'running' ? 'RUNNING' : 'INFO'
                return (
                  <div key={`all-${idx}-${line.slice(0, 16)}`} className={`log-entry ${tone}`}>
                    <span>{String(idx + 1).padStart(3, '0')}</span>
                    <span className="level">{level}</span>
                    <span>{line}</span>
                  </div>
                )
              })}
            </div>
          </article>
          <div className="status-pill">Total de logs: {totalLogLines}</div>
        </section>
      </main>
    </div>
  )
}

