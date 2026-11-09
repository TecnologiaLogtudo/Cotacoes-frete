# Changelog

Todas as alterações notáveis neste projeto serão documentadas neste arquivo.

## [Unreleased] - 2026-11-09

### Adicionado
- **Skill `web-automation-interface`**: Reformulação completa da interface operacional web baseada em job/lote e tokens semânticos.
- `web/src/template.config.js`: Configuração declarativa de marca, fases (F1-F5), operações (D2D/Amazon) e credenciais.
- `web/src/services/api.js`: Camada de serviço de API REST com suporte a modo de demonstração (mock) e backend real.
- `POST /api/jobs/upload-and-validate`: Novo endpoint no FastAPI para análise prévia de integridade, contagem e extração de linhas da planilha antes da submissão.
- `GET /health/ready`: Endpoint de prontidão da API alinhado ao contrato padrão da interface.
- `tests/test_api_endpoints.py`: Testes automatizados para validação de endpoints de API e upload prévio.

### Modificado
- `web/src/App.jsx`: Reformulação em 3 abas integradas (Execução, Histórico e Auditoria & Admin), substituição da marca textual pelo ícone oficial da Logtudo (`logtudo_icon.jpg`), remoção de badges artificiais de status ("API Conectada" e "Sistema Operacional") e adoção de títulos e esteira de fases refinados.
- `web/src/styles.css`: Estilização refinada com traços sutis (hairlines de 1px), remoção de padrões artificiais de IA, suporte pleno a tema claro para o terminal de logs com fundo técnico suave (`#f8fafc`) e texto grafite legível (`#334155`).
- `web/src/main.jsx`: Suporte e normalização de `BASE_PATH` para subcaminho em produção (`/cotacoes/`).
- `automacao/api.py`: Suporte a busca transparente de status e logs tanto por `task_id` quanto por `job_id`, e fallback local para `web/dist`.
