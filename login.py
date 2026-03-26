from automacao.steps.login import realizar_login


if __name__ == "__main__":
    import os

    usuario = os.getenv("LOGTUDO_USER", "ATUALIZARBI")
    senha = os.getenv("LOGTUDO_PASS", "sua_senha_aqui")
    realizar_login(usuario, senha)
