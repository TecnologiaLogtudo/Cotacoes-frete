function resolveApiPrefix() {
  const explicit = (import.meta.env.VITE_API_BASE_URL || '').trim()
  if (explicit) {
    return explicit === '/' ? '' : explicit.replace(/\/+$/, '')
  }

  const base = (import.meta.env.BASE_URL || '').trim()
  if (base && base !== '/') {
    return base.replace(/\/+$/, '')
  }

  if (typeof window !== 'undefined' && window.location?.pathname) {
    const match = window.location.pathname.match(/^(\/[^/]+)/)
    if (match && match[1] !== '/api') {
      return match[1]
    }
  }

  return ''
}

const prefix = resolveApiPrefix()
const mockMode = import.meta.env.VITE_USE_MOCK_API === 'true'

const mockJobs = []
let mockConfig = { throttleSeconds: 2.5, headless: true }

async function request(path, options = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = prefix && !normalizedPath.startsWith(prefix)
    ? `${prefix}${normalizedPath}`
    : normalizedPath
  const response = await fetch(url, options)
  if (!response.ok) {
    let message = `Falha na requisição HTTP (${response.status})`
    try {
      const body = await response.json()
      message = body.detail || body.message || message
    } catch {}
    throw new Error(message)
  }
  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('json') ? response.json() : response
}

function makeDemoJob(filename) {
  const id = `demo-${Date.now()}`
  const items = Array.from({ length: 6 }, (_, i) => ({
    id: `${id}-${i + 1}`,
    reference: `REG-${String(i + 1).padStart(4, '0')}`,
    nome: `Motorista Demo ${i + 1}`,
    placa: `ABC${i + 1}D23`,
    status: 'PENDING',
    message: 'Aguardando processamento',
  }))
  return {
    id,
    job_id: id,
    task_id: id,
    filename,
    status: 'PENDING',
    current_phase: 'F1',
    percent: 0,
    total_items: items.length,
    success_count: 0,
    error_count: 0,
    created_at: new Date().toISOString(),
    items,
    logs: [
      { timestamp: new Date().toLocaleTimeString(), level: 'INFO', phase: 'F1', message: 'Lote carregado em modo de demonstração.' }
    ],
  }
}

export const api = {
  mockMode,
  prefix,

  async health() {
    if (mockMode) return { status: 'ready' }
    try {
      return await request('/health/ready')
    } catch {
      return request('/health')
    }
  },

  async uploadAndValidate(file, dataReferencia = '', tipoOperacao = 'D2D') {
    if (mockMode) {
      const demo = makeDemoJob(file.name)
      mockJobs.unshift(demo)
      return {
        job_id: demo.id,
        filename: file.name,
        is_valid: true,
        total_rows: demo.items.length,
        valid_rows_count: demo.items.length,
        invalid_rows_count: 0,
        row_errors: [],
        preview: demo.items,
        available_dates: [dataReferencia || '07/05/2026'],
      }
    }

    const body = new FormData()
    body.append('file', file)
    if (dataReferencia) body.append('data_referencia', dataReferencia)
    if (tipoOperacao) body.append('tipo_operacao', tipoOperacao)

    return request('/api/jobs/upload-and-validate', {
      method: 'POST',
      body,
    })
  },

  async startJob(jobId, payload) {
    if (mockMode) {
      const target = mockJobs.find((j) => j.id === jobId)
      if (target) {
        target.status = 'RUNNING'
        target.current_phase = 'F2'
        target.logs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: 'INFO',
          phase: 'F2',
          message: 'Automação iniciada pelo operador.',
        })
      }
      return { task_id: jobId, job_id: jobId, status: 'RUNNING' }
    }

    return request(`/api/jobs/${encodeURIComponent(jobId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  async stopJob(jobId) {
    if (mockMode) {
      const target = mockJobs.find((j) => j.id === jobId)
      if (target) {
        target.status = 'CANCELLED'
      }
      return { status: 'CANCELLED', task_id: jobId }
    }

    return request(`/api/jobs/${encodeURIComponent(jobId)}/stop`, {
      method: 'POST',
    })
  },

  async getJob(id) {
    if (mockMode) {
      const job = mockJobs.find((j) => j.id === id) || mockJobs[0] || null
      return { job, items: job?.items || [], logs: job?.logs || [] }
    }
    return request(`/api/jobs/${encodeURIComponent(id)}`)
  },

  async getJobLogs(id, cursor = 0) {
    if (mockMode) {
      const job = mockJobs.find((j) => j.id === id)
      return { task_id: id, cursor, next_cursor: cursor, lines: job?.logs?.map((l) => l.message) || [] }
    }
    return request(`/api/jobs/${encodeURIComponent(id)}/logs?cursor=${cursor}`)
  },

  async listJobs(status = '', limit = 100) {
    if (mockMode) {
      return { jobs: mockJobs }
    }
    try {
      const url = status ? `/api/admin/jobs?status=${encodeURIComponent(status)}` : `/api/jobs?limit=${limit}`
      const res = await request(url)
      return { jobs: res.jobs || res.items || [] }
    } catch {
      const fallback = await request('/api/admin/jobs')
      return { jobs: fallback.items || [] }
    }
  },

  async getAdminSummary() {
    if (mockMode) {
      return {
        total_jobs: mockJobs.length,
        success_jobs: mockJobs.filter((j) => j.status === 'COMPLETED').length,
        error_jobs: mockJobs.filter((j) => j.status === 'FAILED').length,
        running_jobs: mockJobs.filter((j) => j.status === 'RUNNING').length,
      }
    }
    return request('/api/admin/summary')
  },

  async getJobActions(jobId) {
    if (mockMode) return { items: [] }
    return request(`/api/admin/jobs/${encodeURIComponent(jobId)}/actions`)
  },

  async getJobSteps(jobId) {
    if (mockMode) return { items: [] }
    return request(`/api/admin/jobs/${encodeURIComponent(jobId)}/steps`)
  },

  async getJobBrowserLogs(jobId) {
    if (mockMode) return { items: [] }
    return request(`/api/admin/jobs/${encodeURIComponent(jobId)}/browser-logs`)
  },

  async getJobArtifacts(jobId) {
    if (mockMode) return { items: [] }
    return request(`/api/admin/jobs/${encodeURIComponent(jobId)}/artifacts`)
  },

  getArtifactDownloadUrl(artifactId) {
    return `${prefix}/api/admin/artifacts/${encodeURIComponent(artifactId)}/file`
  },

  async resetLogs(password) {
    if (mockMode) return { ok: true }
    return request('/api/admin/reset-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  },
}
