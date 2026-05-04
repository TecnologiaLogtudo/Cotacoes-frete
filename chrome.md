O problema está 100% no Chrome: ele não está subindo com o debugger na porta 9223, por isso nem o Windows (127.0.0.1:9223) nem o WSL conseguem conectar. Enquanto isso não funcionar no próprio Windows, o OpenClaw não tem como falar com esse Chrome.

Passo 1 – Garantir Chrome com debug remoto
Feche todas as janelas do Chrome no Windows (confere no Gerenciador de Tarefas se não ficou nenhum chrome.exe).

Depois, no PowerShell (Windows), copia e roda exatamente (sem atalhos, sem clicar em ícone):

powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\Temp\chrome-openclaw"
Se der erro de caminho, tenta:

powershell
& "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\Temp\chrome-openclaw"
Importante:

Usa --user-data-dir para garantir que essa instância não está sendo “engolida” pela sessão padrão.

Deixa essa janela aberta e entra em qualquer site.

Agora, ainda no Windows, testa de novo:

powershell
curl http://127.0.0.1:9223/json/version
Se continuar falhando, o Chrome não está respeitando a flag (atalho errado, outro Chrome abrindo no lugar, política corporativa, etc.). Nesse ponto, o mais prático é:

Confirmar o caminho real do Chrome:

powershell
Get-Command chrome.exe
Ou testar Edge com mesma ideia:

powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9223 --user-data-dir="C:\Temp\edge-openclaw"
curl http://127.0.0.1:9223/json/version
Enquanto esse curl 127.0.0.1:9223/json/version não retornar JSON, não vale nem mexer no WSL nem no OpenClaw.

Passo 2 – Só depois pensar no WSL/OpenClaw
Quando (e só quando) isso funcionar no Windows:

A gente pega o IP que o WSL enxerga como host (já vimos 10.255.255.254, mas vamos validar depois).

Testa no WSL:

bash
curl http://10.255.255.254:9223/json/version
Aí eu te mando o openclaw.json com driver e cdpEndpoint certinhos para esse IP/porta.

Enquanto o teste no Windows está falhando, o gargalo é: Chrome não está expondo CDP. O próximo passo é só um: rodar o Chrome ou Edge com o comando exato e me mandar a saída do:

powershell
curl http://127.0.0.1:9223/json/version
Você consegue rodar esse comando de lançamento (com --user-data-dir) e me colar a saída desse curl do Windows?