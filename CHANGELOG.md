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
