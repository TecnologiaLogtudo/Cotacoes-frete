import os

from Conectividade.playwright_vps_connect import PlaywrightVPSConfig, PlaywrightVPSClient
from automacao.config_loader import carregar_mapeamento


MAPPINGS = carregar_mapeamento()
URL_LOGIN = MAPPINGS["urls"]["login"]
SEL_USUARIO = MAPPINGS["selectors"]["campo_usuario"]
SEL_SENHA = MAPPINGS["selectors"]["campo_senha"]
SEL_ENTRAR = MAPPINGS["selectors"]["botao_entrar"]


def realizar_login(usuario: str, senha: str) -> None:
    """Executa o login no Logtudo."""
    config = PlaywrightVPSConfig(headless=True)

    with PlaywrightVPSClient(config) as client:
        page = client.page

        print("Acessando a URL de login...")
        page.goto(URL_LOGIN, wait_until="domcontentloaded")

        print("Preenchendo usuário e senha...")
        page.locator(SEL_USUARIO).fill(usuario)
        page.locator(SEL_SENHA).fill(senha)

        print("Clicando no botão Entrar...")
        page.locator(SEL_ENTRAR).click()
        page.wait_for_load_state("networkidle")

        print("Login concluído com sucesso!")


if __name__ == "__main__":
    usuario = os.getenv("LOGTUDO_USER", "ATUALIZARBI")
    senha = os.getenv("LOGTUDO_PASS", "sua_senha_aqui")
    realizar_login(usuario, senha)
