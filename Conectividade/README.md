# Conectividade Playwright para VPS

Este diretório contém arquivos base para subir Playwright em VPS com Docker, mantendo sandbox ativo e configuração estável para Chromium.

## Arquivos

- `Dockerfile.playwright-vps`: imagem base Python + Playwright para produção.
- `docker-compose.playwright-vps.yml`: serviço pronto com `ipc: host` e `seccomp` custom.
- `seccomp-playwright.json`: libera syscalls necessárias para user namespace (`clone`, `setns`, `unshare`).
- `playwright_vps_connect.py`: módulo Python reutilizável para inicializar Playwright com padrões seguros.
- `requirements-playwright-vps.txt`: dependências mínimas.
- `.env.playwright-vps.example`: variáveis de ambiente sugeridas.

## Uso rápido

1. Copie os arquivos para seu projeto.
2. Ajuste o `command` no compose para o entrypoint da sua aplicação.
3. Se necessário, ajuste volumes/pastas de escrita para seu app.
4. Build e deploy:

```bash
docker compose -f docker-compose.playwright-vps.yml up -d --build
```

## Import no Python

```python
from playwright_vps_connect import PlaywrightVPSConfig, PlaywrightVPSClient

cfg = PlaywrightVPSConfig(headless=True)
with PlaywrightVPSClient(cfg) as client:
    page = client.page
    page.goto("https://example.com", wait_until="domcontentloaded")
    print(page.title())
```

## Notas de VPS

- Evite rodar como `root` dentro do container para manter melhor compatibilidade com sandbox.
- `ipc: host` ajuda estabilidade de Chromium em ambiente com pouca memória compartilhada.
- Mantenha `seccomp` apontando para `seccomp-playwright.json`.
