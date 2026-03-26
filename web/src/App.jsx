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

function lineClass(line) {
  const norm = line.toLowerCase()
  if (norm.includes('erro') || norm.includes('traceback') || norm.includes('exception')) return 'line error'
  if (norm.includes('conclu') || norm.includes('sucesso')) return 'line success'
  if (norm.includes('processando linha')) return 'line running'
  return 'line info'
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

  async function handleSubmit(e) {
    e.preventDefault()
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

  return (
    <div className="page">
      <header className="hero">
        <h1>Jobs de Cotação</h1>
        <p>Painel para envio de planilha e monitoramento da automação em tempo real.</p>
      </header>

      <main className="grid">
        <section className="card">
          <h2>Parâmetros</h2>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Login
              <input value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
            </label>

            <label>
              Senha
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </label>

            <label>
              Data de Cotação
              <input
                placeholder="dd/mm/aaaa"
                value={dataReferencia}
                onChange={(e) => setDataReferencia(e.target.value)}
                required
              />
            </label>

            <label>
              Validade
              <input
                placeholder="dd/mm/aaaa"
                value={validade}
                onChange={(e) => setValidade(e.target.value)}
                required
              />
            </label>

            <label>
              Planilha (.xlsx)
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setPlanilha(e.target.files?.[0] || null)}
                required
              />
            </label>

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Enfileirando...' : 'Iniciar processamento'}
            </button>
          </form>
          {error && <p className="errorText">{error}</p>}
        </section>

        <section className="card">
          <div className="row">
            <h2>Execução</h2>
            <span className={statusClass(jobStatus)}>{jobStatus}</span>
          </div>

          <div className="meta">
            <p><strong>Task ID:</strong> {taskId || '-'}</p>
            <p><strong>Progresso:</strong> {progressText}</p>
          </div>

          <div className="row logsHeader">
            <h3>Logs</h3>
            <button type="button" className="minor" onClick={() => setAutoScroll((v) => !v)}>
              {autoScroll ? 'Pausar auto-scroll' : 'Ativar auto-scroll'}
            </button>
          </div>

          <div className="logs" ref={logsRef}>
            {logs.length === 0 ? (
              <p className="placeholder">Sem logs ainda.</p>
            ) : (
              logs.map((line, idx) => (
                <div key={`${idx}-${line.slice(0, 12)}`} className={lineClass(line)}>
                  {line}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

