# Changelog

Todas as alterações notáveis neste projeto serão documentadas neste arquivo.

## [Unreleased] - 2026-11-10

### Corrigido
- `automacao/api.py` & `automacao/observabilidade.py`:
  - **Prevenção de execução fantasma após upload**: `_admin_status_from_job` e `get_job_status` agora retornam `status: "READY"` e `current_phase: "F1"` para lotes apenas validados e ainda não iniciados. Impede que o frontend interprete o lote recém-validado como "STARTED/RUNNING" e trave o botão de início.
  - **Novo endpoint de interrupção (`POST /api/jobs/{task_id}/stop` e `/cancel`)**: cancela a tarefa na fila do RQ e persiste o status `cancelled` no SQLite com log descritivo, impedindo que o polling reverta o cancelamento de volta para "Em andamento".
- `web/src/App.jsx` & `web/src/services/api.js`:
  - **Fluxo de validação sem polling precoce**: ao enviar a planilha, o lote ativo recebe `status: 'READY'`. O hook de polling agora só inicia após o enfileiramento real no worker (com a presença de `task_id`), deixando o botão "Iniciar cotação" habilitado e o Lote Ativo como "Pronto".
  - **Auto-seleção da data da planilha**: a data de referência é preenchida automaticamente a partir das datas válidas identificadas na validação da planilha (`report.available_dates`), caso o operador ainda não a tenha preenchido.
  - **Interrupção efetiva**: o botão "Interromper" dispara `api.stopJob(activeId)` persistindo o cancelamento imediatamente no backend.
- `tests/test_api_endpoints.py`:
  - Adicionados testes `test_stop_job_endpoint` e `test_unstarted_job_status_ready`.
- `automacao/observabilidade.py`:
  - **Resolução bidirecional de identificadores (`_resolve_task_ids`)**: `steps_for_job`, `actions_for_job`, `browser_logs_for_job` e `artifacts_for_job` agora consultam indistintamente tanto pelo `task_id` (UUID do RQ) quanto pelo `job_id` sequencial (ex.: `10112026-0001`), eliminando consultas vazias quando a interface envia o `job_id`.
  - **Enriquecimento de `_build_job_item`**: identificação dinâmica do nome original do arquivo na pasta de uploads ou nos logs (`filename`), contagem de linhas e progresso real (`total_items`, `total_lines`, `processed_lines`, `error_count`, `percent`), corrigindo o problema de lotes exibindo `ITENS 0/0` e nome genérico (`relatorio.xlsx`) no histórico.
  - **Limpeza de chaves fantasmas do Redis**: remoção da varredura irrestrita `rq:job:*` que gerava lotes fantasmas com status `running`/`pending` na inicialização; adição de detecção de estagnação (> 1h) para evitar que lotes sem worker fiquem como "Aguardando" indefinidamente.
  - **Padronização de contratos nos endpoints de auditoria**: normalização de aliases nas respostas (`step`/`name`/`nome`, `timestamp`/`created_at`, `message`/`detalhes`, `action`/`action_type`, `target`/`actor`).
- `automacao/steps/passo2_cotacoes.py`:
  - Conexão de listeners `page.on("console")` e `page.on("pageerror")` no Playwright para capturar os logs reais do console e erros JavaScript do navegador diretamente nos logs da automação e na tabela de logs do navegador.
- `web/src/App.jsx`:
  - Atualização do mapa de status (`statusMap`): status `STARTED` e `RUNNING` passam a usar `tone: 'running'` (azul com indicador luminoso), deixando de ser renderizados em verde como se fossem concluídos.
  - Correção na aba **Admin**: a tabela de Etapas agora renderiza corretamente as colunas Etapa (`s.name || s.step || s.nome`), Mensagem (`s.message || s.detalhes`) e Data/Hora (`formatIsoForDisplay(s.timestamp || s.started_at)`); a aba Ações agora exibe o tipo de ação e o ator/IP corretamente.
  - Correção na aba **Histórico**: cálculo de erros e total de itens conectado aos novos campos enriquecidos da API.
- `web/src/styles.css`:
  - Adicionado estilo `.status-indicator.running` com tom azul (`#3b82f6`) e indicador pulsante sutil.
- `tests/test_api_endpoints.py`:
  - Adicionado teste `test_admin_steps_and_actions_by_job_id` validando busca de etapas e ações via `job_id` sequencial e integridade dos campos enriquecidos de lote.
- `automacao/api.py`:
  - Corrigida a extração de mensagens de erro detalhadas em `get_job_status` a partir dos eventos em `job_actions` (`action_type`) registrados na observabilidade SQLite, permitindo que exceções do robô (ex: `Nao foi encontrada opcao de remetente para a cidade/base: PORTO SEGURO`) sejam devolvidas diretamente ao frontend.
  - Sincronização do status dos itens do lote na resposta de `/api/jobs/{task_id}`: leitura da planilha correspondente no diretório de uploads e atribuição de `status: FAILED` e mensagem explicativa a todos os itens pendentes quando o job encerra com erro.
- `automacao/queue.py`:
  - Adicionado tratamento resiliente em `fetch_job` contra `ConnectionError` e outras exceções quando o Redis estiver inacessível, caindo suavemente para o fallback SQLite.
- `web/src/App.jsx`:
  - Finalização reativa e imediata do lote no frontend ao receber erro da automação: a régua de progresso ganha indicador visual de falha, a fase ativa (F3) transiciona para o estado comemorativo de erro (vermelho com ícone `✕` e rótulo `Falhou`), e o subhead exibe em destaque o motivo da interrupção (`COTAÇÃO INTERROMPIDA POR ERRO — [motivo]`).
  - Atualização do bloco **Itens do Lote** para refletir os itens com badge `Falhou` e mensagem de erro específica.
  - Atualização do modal de detalhes do histórico (`HistoryDetailModal`) para mapear itens de lotes falhados para `FAILED`, populando corretamente os contadores KPI de `ERROS`, `CONCLUÍDOS` e `PENDENTES`.
- `web/src/styles.css`:
  - Adicionadas classes e variantes de erro para barras de progresso (`.batch-progress-fill-primary.error`, `.batch-progress-fill-secondary.error`), fases (`.phase-step-col.failed`) e badges (`.batch-status-pill.failed`).
  - Fixada a altura máxima do **Console de Execução** (`.terminal-execution-card`) e de **Itens do Lote** (`.batch-items-card`) em `500px` com `min-height: 0` e `overflow-y: auto`, ativando o scroll vertical e impedindo que o console cresça indefinidamente para baixo com a chegada de novos logs. Adicionada estilização de scrollbar escura/sutil.
- `web/src/services/api.js`: Resolução automática e resiliente do prefixo da API (`resolveApiPrefix`), compatível com subpath reverso (`/cotacoes/`). Corrige erro 404 (`API route not found`) que impedia o carregamento do histórico, das métricas do admin e a renderização dos dados validados ao subir a planilha. Proteção contra duplicação de prefixos na função `request`.
- `tests/test_api_endpoints.py`:
  - Adicionado teste `test_get_job_status_failed_job_observabilidade` validando recuperação de falhas via observabilidade SQLite, extração do erro de remetente e integridade dos campos devolvidos pela API.

## [1.0.0] - 2026-11-09

### Adicionado
- **Skill `web-automation-interface`**: Reformulação completa da interface operacional web baseada em job/lote e tokens semânticos.
- `web/src/template.config.js`: Configuração declarativa de marca, fases (F1-F5), operações (D2D/Amazon) e credenciais.
- `web/src/services/api.js`: Camada de serviço de API REST com suporte a modo de demonstração (mock) e backend real.
- `POST /api/jobs/upload-and-validate`: Novo endpoint no FastAPI para análise prévia de integridade, contagem e extração de linhas da planilha antes da submissão.
- `GET /health/ready`: Endpoint de prontidão da API alinhado ao contrato padrão da interface.
- `tests/test_api_endpoints.py`: Testes automatizados para validação de endpoints de API e upload prévio.

### Modificado
- `web/src/App.jsx` & `web/src/styles.css`:
  - **Modal de Detalhes da Execução do Histórico**: implementado modal fiel à referência (`media_1794256183254_9b4a229c.png`), acionado ao clicar no botão de detalhes (`👁`) em qualquer linha do Histórico de Lotes. Contém cabeçalho completo com metadados e operador, 3 cards KPI (`CONCLUÍDOS`, `ERROS`, `PENDENTES`), tabela de `ITENS (N)` com badges de CTE e status pills, e lista de `ARTIFACTS (N)` (`SCREENSHOT_ERROR`, `EXCEL_RESULT`, `VIDEO_RECORDING`) com preview e download integrados. Fechamento via `Escape` ou clique no overlay.
  - **Reformulação do layout do Histórico de Lotes**: alinhado fielmente à imagem de referência (`media_1794254945848_0e63fa87.png`), com 8 colunas padronizadas (`LOTE`, `ARQUIVO`, `STATUS`, `PROGRESSO`, `ITENS`, `DURAÇÃO`, `CRIADO EM`, `RASTREIO`), pills de status ovais (`Concluído`, `Cancelado`, `Falhou`, `Aguardando`), barra fina de progresso, destaque para falhas `(X err)` em vermelho e ações de visualização/download de artefatos.
  - Adicionado cabeçalho de Histórico com contador dinâmico (`X de Y`), campo de busca por arquivo/lote e dropdown de filtro por status (`TODOS ˅`).
  - Carregamento automático e reativo de lotes ao selecionar a aba Histórico (`useEffect` em `tab === 'history'`).
- `automacao/observabilidade.py` & `automacao/queue.py`:
  - Otimização de latência em ambientes sem Redis: verificação única e não-bloqueante de conectividade do Redis com fallback direto para SQLite (`_is_redis_available()`), reduzindo o tempo de resposta da listagem de lotes de ~20s para sub-segundo em ambiente local/Windows.
- `web/src/App.jsx`: Tela reestruturada com rigor visual e aderência completa às regras de domínio do projeto `Logtudo Cotação de Frete`:
  - Correção das nomenclaturas: **LogTudo Cotações**, **Cotação de Frete**, **CREDENCIAIS DO PORTAL & FILTROS** e **PLANILHA DE COTAÇÃO**.
  - Correção da grade de layout: contêineres de Credenciais/Filtros (esquerda) e Planilha (direita) posicionados lado a lado (`grid 2 colunas`), com alturas idênticas e alinhamento responsivo.
  - Reorganização do layout inferior com o **Console de Execução à esquerda** (com controles estilo macOS, filtros e ações rápidas) e **ITENS DO LOTE à direita** (com colunas: Número, Motorista/Placa, Frete valor, Frete negociado, Status e Detalhes).
  - Abertura dinâmica do card de **Fases do processamento** com **duas barras de progresso** (progresso geral de itens e avanço das fases) e stepper de alta visibilidade (F1 a F5) assim que a planilha é validada.
  - Painel integrado de detalhes do registro (`DET.`) embutido no card de itens do lote (conforme imagem de referência), com resumo do item (Linha/Cotação, CTE Emitido, Motorista e Duração), bloco com o motivo do erro e link direto com visualizador para o screenshot de erro do robô.
  - Card de **Lote Ativo** na barra lateral alinhado à identidade visual da referência.
  - Paleta escura azulada (`#0b0f19` / `#0d131f`) com contornos sutis em azul claro (`rgba(59, 130, 246, 0.28)`), removendo o cabeçalho superior redundante e detalhes dourados.
- `web/src/styles.css`: Definição corrigida e explícita das classes de grid (`.two-col`, `.stack`, `.grid`, `.dropzone-rect`) e alinhamento vertical dos cards.
- `web/vite.config.js`: Porta do Vite fixada em `5180` com `strictPort: true` para eliminar concorrência com outros projetos locais em execução; regras de proxy atualizadas para suportar paths prefixados com `^(/cotacoes)?/` com rewrite automático.
- `web/src/services/api.js`: Base URL ajustada para evitar herdar o `BASE_URL` dos assets do Vite (`/cotacoes/`), prevenindo erro 404 no envio de requisições de API em ambiente de desenvolvimento.
- `automacao/api.py`: Adicionado middleware HTTP transparente para reescrita de rotas com prefixo `/cotacoes/api/`, `/cotacoes/health` e `/cotacoes/manual-de-uso`.
- `tests/test_api_endpoints.py`: Adicionado teste automatizado cobrindo requisições com prefixo `/cotacoes/`.
- `web/src/template.config.js`: Parâmetro `maxSizeMB: 100` e mensagem explicativa de limite de 100 MB para upload da planilha.
- `automacao/api.py`: Limite de tamanho de planilha aumentado para 100 MB (`MAX_XLSX_SIZE_BYTES = 100 * 1024 * 1024`), com suporte a streaming em chunks de 1 MB.

### Removido
- `web/src/App.jsx`: Remoção completa de dados hardcoded, mocks estáticos e fallbacks de teste (`MOCK_ITEMS_HISTORICO`, `getMockArtifacts`, nomes fictícios e placeholders), garantindo que todos os dados de lotes, itens, artefatos e métricas sejam alimentados exclusivamente pelas rotas dinâmicas da API em produção.
- `web/src/legacy/`: Excluída a versão anterior (V1 e legado) e seus arquivos CSS/JSX associados.
