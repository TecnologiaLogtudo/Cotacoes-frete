import os
import random
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from Conectividade.playwright_vps_connect import PlaywrightVPSConfig, PlaywrightVPSClient
from automacao.config_loader import carregar_mapeamento
from automacao.planilha import LinhaAutomacao, carregar_linhas_para_automacao


MAPPINGS = carregar_mapeamento()
URL_LOGIN = MAPPINGS["urls"]["login"]
URL_PASSO_2 = MAPPINGS["urls"]["cotacoes_frete"]
SEL_USUARIO = MAPPINGS["selectors"]["campo_usuario"]
SEL_SENHA = MAPPINGS["selectors"]["campo_senha"]
SEL_ENTRAR = MAPPINGS["selectors"]["botao_entrar"]
SEL_ADICIONAR = MAPPINGS["selectors"]["botao_adicionar"]
SEL_RADIO_PAGAMENTO_FRETE = MAPPINGS["selectors"]["radio_pagamento_frete"]
SEL_AGENCIA = MAPPINGS["selectors"]["select_agencia"]
SEL_STATUS = MAPPINGS["selectors"]["select_status"]
SEL_REGRA_FRETE = MAPPINGS["selectors"]["select_regra_frete"]
SEL_BOTAO_SUGERIR_TABELA = MAPPINGS["selectors"]["botao_sugerir_tabela_precos"]
SEL_FRETE_NEGOCIADO = MAPPINGS["selectors"]["campo_frete_negociado"]
SEL_OPERACAO = MAPPINGS["selectors"]["campo_operacao"]
SEL_PESQUISAR_OPERACAO = MAPPINGS["selectors"]["botao_pesquisar_operacao"]
SEL_KM = MAPPINGS["selectors"]["campo_km"]
SEL_NUMERO = MAPPINGS["selectors"]["campo_numero"]
SEL_NUMERO_PEDIDO_CLIENTE = MAPPINGS["selectors"]["campo_numero_pedido_cliente"]
SEL_VALIDADE = MAPPINGS["selectors"]["campo_validade"]
SEL_CATEGORIA_VEICULO = MAPPINGS["selectors"]["select_categoria_veiculo"]
SEL_BTN_PESQ_CATEGORIA_VEICULO = MAPPINGS["selectors"]["botao_pesquisar_categoria_veiculo"]
SEL_PESQ_REMETENTE = MAPPINGS["selectors"]["campo_pesquisa_remetente"]
SEL_BTN_PESQ_REMETENTE = MAPPINGS["selectors"]["botao_pesquisar_remetente"]
SEL_REMETENTE = MAPPINGS["selectors"]["select_remetente"]
SEL_UF_INI = MAPPINGS["selectors"]["campo_uf_ini"]
SEL_UF_FIM = MAPPINGS["selectors"]["campo_uf_fim"]
SEL_CIDADE_INI = MAPPINGS["selectors"]["select_cidade_ini"]
SEL_PESQ_CIDADE_FIM = MAPPINGS["selectors"]["campo_pesquisa_cidade_fim"]
SEL_BTN_PESQ_CIDADE_FIM = MAPPINGS["selectors"]["botao_pesquisar_cidade_fim"]
SEL_OBS_INTERNA = MAPPINGS["selectors"]["campo_obs_interna"]
SEL_BOTAO_CADASTRAR = MAPPINGS["selectors"]["botao_cadastrar"]

OPT_AGENCIA_MATRIZ_BAHIA = MAPPINGS["options"]["agencia_matriz_bahia"]
OPT_STATUS_APROVADO_CLIENTE = MAPPINGS["options"]["status_aprovado_cliente"]
OPT_REGRA_FRETE_COTACAO_LATAM = MAPPINGS["options"]["regra_frete_cotacao_latam"]
OPT_OPERACAO_CARGA_FECHADA = MAPPINGS["options"]["operacao_carga_fechada"]
OPT_TERMO_PESQ_REMETENTE = MAPPINGS["options"]["termo_pesquisa_remetente"]
OPT_PAGAMENTO_FRETE_RADIO_VALUE = MAPPINGS["options"]["pagamento_frete_radio_value"]


def _capturar_screenshot_erro(page, artifacts_path: str | None) -> Path | None:
    if not artifacts_path:
        return None

    target_dir = Path(artifacts_path)
    target_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = target_dir / f"erro-{datetime.now().strftime('%Y%m%d-%H%M%S')}.png"
    page.screenshot(path=str(screenshot_path), full_page=True)
    return screenshot_path

def aguardar_renderizacao_total(page, contexto: str) -> None:
    print(f"Aguardando renderizacao total da pagina ({contexto})...")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.wait_for_function("() => document.readyState === 'complete'")



def aguardar_10s_ou_renderizar(page, contexto: str) -> None:
    print(f"Aguardando ate 10s ou renderizacao da pagina ({contexto})...")
    try:
        page.wait_for_function("() => document.readyState === 'complete'", timeout=10000)
    except PlaywrightTimeoutError:
        print(f"Renderizacao nao concluiu em 10s ({contexto}); seguindo fluxo.")

def normalizar_texto(texto: str) -> str:
    sem_acentos = unicodedata.normalize("NFKD", texto).encode("ASCII", "ignore").decode("ASCII")
    return sem_acentos.upper().strip()


def calcular_data_pagamento(operacao: str, validade: str, data_referencia_original: str) -> str:
    m = re.search(r"(\d{1,2})\/\-(?:\/\-)?", validade)
    if not m:
        return data_referencia_original

    dia = int(m.group(1))
    mes = int(m.group(2))
    ano = m.group(3)
    ano_int = int(ano) if ano else datetime.now().year
    if ano and len(ano) == 2:
        ano_int += 2000

    op_norm = operacao.strip().upper()

    if op_norm == "FIXO":
        dia_calc = 20
        mes_calc = mes + 1
    elif op_norm == "SPOT":
        if dia <= 15:
            dia_calc = 25
            mes_calc = mes
        else:
            dia_calc = 10
            mes_calc = mes + 1
    else:
        return data_referencia_original

    ano_calc = ano_int
    if mes_calc > 12:
        mes_calc = 1
        ano_calc += 1

    if ano:
        ano_str = str(ano_calc) if len(ano) == 4 else str(ano_calc)[-2:]
        return f"{dia_calc:02d}/{mes_calc:02d}/{ano_str}"
    return f"{dia_calc:02d}/{mes_calc:02d}"


def realizar_login_na_sessao(page, usuario: str, senha: str) -> None:
    print("Acessando a tela de login...")
    page.goto(URL_LOGIN, wait_until="domcontentloaded")

    print("Preenchendo credenciais...")
    page.locator(SEL_USUARIO).fill(usuario)
    page.locator(SEL_SENHA).fill(senha)
    page.wait_for_timeout(1500)

    print("Enviando formulário de login...")
    page.locator(SEL_ENTRAR).click()
    print("Aguardando 10s apos clicar em Entrar...")
    page.wait_for_timeout(10000)
    aguardar_renderizacao_total(page, contexto="pos-login")
    print("Login concluído com sucesso!")


def acessar_url_cotacoes_e_aguardar(page) -> None:
    print(f"Acessando a URL de cotacoes de frete: {URL_PASSO_2}")
    page.goto(URL_PASSO_2, wait_until="domcontentloaded")
    aguardar_renderizacao_total(page, contexto="tela de cotacoes de frete")
    print("Aguardando 4s antes de procurar o botao Adicionar...")
    page.wait_for_timeout(4000)
    page.locator(SEL_ADICIONAR).first.wait_for(state="visible")

def marcar_pagamento_frete(page) -> None:
    seletor_radio = f"{SEL_RADIO_PAGAMENTO_FRETE}[value='{OPT_PAGAMENTO_FRETE_RADIO_VALUE}']"
    print(f"Marcando radio de Frete com value '{OPT_PAGAMENTO_FRETE_RADIO_VALUE}'...")
    radio = page.locator(seletor_radio).first
    radio.wait_for(state="attached", timeout=5000)

    try:
        radio.check(timeout=2000)
        return
    except PlaywrightTimeoutError:
        print("Radio de frete nao ficou visivel para check(); tentando fallback label/JS...")

    resultado = page.evaluate(
        """({ selector }) => {
            const input = document.querySelector(selector);
            if (!input) return { ok: false, motivo: "input_nao_encontrado" };

            const disparar = (nomeEvento) => {
                input.dispatchEvent(new Event(nomeEvento, { bubbles: true }));
            };

            if (input.id) {
                const label = document.querySelector(`label[for="${input.id}"]`);
                if (label) {
                    const estilo = window.getComputedStyle(label);
                    const visivel = label.getClientRects().length > 0
                        && estilo.display !== "none"
                        && estilo.visibility !== "hidden";
                    if (visivel) {
                        label.click();
                        if (input.checked) return { ok: true, modo: "label" };
                    }
                }
            }

            input.checked = true;
            disparar("input");
            disparar("change");
            disparar("click");
            return { ok: !!input.checked, modo: "js" };
        }""",
        {"selector": seletor_radio},
    )
    if not resultado.get("ok"):
        raise ValueError(f"Nao foi possivel marcar pagamento de frete em '{seletor_radio}'")
    print(f"Pagamento de frete marcado com fallback: {resultado.get('modo', 'desconhecido')}")


def selecionar_regra_frete_e_sugerir_tabela(page) -> None:
    print(f"Selecionando Regra de frete: {OPT_REGRA_FRETE_COTACAO_LATAM}...")
    page.locator(SEL_REGRA_FRETE).select_option(label=OPT_REGRA_FRETE_COTACAO_LATAM)

    print("Clicando em Sugerir tabela de preços...")
    page.locator(SEL_BOTAO_SUGERIR_TABELA).click()
    page.wait_for_timeout(800)


def preencher_frete_negociado(page, frete_negociado: str, data_referencia: str) -> None:
    print(f"Preenchendo Frete Negociado para data '{data_referencia}': {frete_negociado}")
    page.locator(SEL_FRETE_NEGOCIADO).fill(str(frete_negociado))


def preencher_obs_interna(page, nome_motorista: str, placa: str, data_referencia: str) -> None:
    texto_obs = f"{nome_motorista} | {placa} | {data_referencia}"
    print(f"Preenchendo campo Interna: {texto_obs}")
    page.locator(SEL_OBS_INTERNA).fill(texto_obs)


def copiar_uf_e_cidade_origem_para_destino(page) -> None:
    uf_ini = page.locator(SEL_UF_INI).input_value().strip()
    if not uf_ini:
        raise ValueError("Campo UF inicial (dados_UFIni) veio vazio; nao foi possivel preencher F. Prest.")

    print(f"Copiando UF inicial para F. Prest.: {uf_ini}")
    page.locator(SEL_UF_FIM).fill(uf_ini)

    cidade_ini = page.eval_on_selector(
        SEL_CIDADE_INI,
        "el => { const opt = el.options[el.selectedIndex]; return opt ? (opt.textContent || '').trim() : ''; }",
    )
    cidade_ini = (cidade_ini or "").strip()
    if not cidade_ini:
        raise ValueError("Nao foi possivel obter a cidade inicial selecionada em dados_cMunIni.")

    print(f"Copiando cidade inicial para pesquisa de cidade final: {cidade_ini}")
    page.locator(SEL_PESQ_CIDADE_FIM).fill(cidade_ini)
    print("Clicando em Pesquisar (Cidade final)...")
    page.locator(SEL_BTN_PESQ_CIDADE_FIM).click()
    page.wait_for_timeout(1000)


def selecionar_categoria_veiculo_por_perfil(page, perfil: str) -> None:
    print("Clicando em Pesquisar (Categoria Veículo)...")
    page.locator(SEL_BTN_PESQ_CATEGORIA_VEICULO).click()
    page.wait_for_timeout(1000)
    print(f"Selecionando Cat. Veículo com valor da coluna 'Perfil': {perfil}")
    page.locator(SEL_CATEGORIA_VEICULO).select_option(label=perfil)


def selecionar_remetente_por_base(page, base: str) -> None:
    print(f"Pesquisando remetente por termo: {OPT_TERMO_PESQ_REMETENTE}")
    page.locator(SEL_PESQ_REMETENTE).fill(OPT_TERMO_PESQ_REMETENTE)
    page.wait_for_timeout(1000)
    page.locator(SEL_BTN_PESQ_REMETENTE).click()
    page.wait_for_timeout(1000)

    page.locator(SEL_REMETENTE).wait_for(state="visible")
    opcoes = page.eval_on_selector_all(
        f"{SEL_REMETENTE} option",
        "els => els.map(el => ({ value: el.value, label: (el.textContent || '').trim() }))",
    )

    base_norm = normalizar_texto(base)
    marcador_cidade = f" - {base_norm} - "

    opcao_encontrada = None
    for opcao in opcoes:
        label_norm = normalizar_texto(opcao["label"])
        if marcador_cidade in label_norm and opcao["value"]:
            opcao_encontrada = opcao
            break

    if not opcao_encontrada:
        raise ValueError(f"Nao foi encontrada opcao de remetente para a cidade/base: {base}")

    print(f"Selecionando remetente para Base '{base}': {opcao_encontrada['label']}")
    page.locator(SEL_REMETENTE).select_option(value=opcao_encontrada["value"])


def clicar_cadastrar_e_aguardar(page) -> None:
    url_anterior = page.url
    print("Clicando no botão Cadastrar...")
    page.locator(SEL_BOTAO_CADASTRAR).click()

    try:
        page.wait_for_function(
            "urlAnterior => window.location.href !== urlAnterior",
            arg=url_anterior,
            timeout=10000,
        )
        print(f"URL alterada com sucesso: {page.url}")
    except PlaywrightTimeoutError:
        print("URL nao mudou em 10s; continuando para a próxima linha.")

    aguardar_renderizacao_total(page, contexto="apos-cadastrar")


def preencher_formulario_linha(page, linha: LinhaAutomacao, validade: str, data_referencia: str) -> None:
    acessar_url_cotacoes_e_aguardar(page)

    print("Clicando em Adicionar...")
    page.locator(SEL_ADICIONAR).first.click()

    print("Selecionando Agência: LOGTUDO MATRIZ - BAHIA...")
    page.locator(SEL_AGENCIA).wait_for(state="visible")
    page.locator(SEL_AGENCIA).select_option(label=OPT_AGENCIA_MATRIZ_BAHIA)

    print("Selecionando Status: Aprovado Cliente...")
    page.locator(SEL_STATUS).select_option(label=OPT_STATUS_APROVADO_CLIENTE)

    print("Digitando Operação: Carga fechada...")
    page.locator(SEL_OPERACAO).fill(OPT_OPERACAO_CARGA_FECHADA)
    page.wait_for_timeout(1000)

    print("Clicando em Pesquisar (Operação)...")
    page.locator(SEL_PESQUISAR_OPERACAO).click()
    page.wait_for_timeout(1000)

    selecionar_categoria_veiculo_por_perfil(page, perfil=linha.perfil)

    km_aleatorio = random.randint(50, 100)
    print(f"Preenchendo Km com valor aleatório: {km_aleatorio}")
    page.locator(SEL_KM).fill(str(km_aleatorio))

    print(f"Preenchendo Nº com valor da coluna 'Número': {linha.numero}")
    page.locator(SEL_NUMERO).fill(linha.numero)

    print("Preenchendo Nº Pedido Cliente com o mesmo valor de Nº...")
    page.locator(SEL_NUMERO_PEDIDO_CLIENTE).fill(linha.numero)

    print(f"Preenchendo Validade com valor informado pelo usuário: {validade}")
    page.locator(SEL_VALIDADE).fill(validade)

    marcar_pagamento_frete(page)
    selecionar_remetente_por_base(page, base=linha.base)
    copiar_uf_e_cidade_origem_para_destino(page)
    selecionar_regra_frete_e_sugerir_tabela(page)

    preencher_frete_negociado(page, frete_negociado=linha.frete_negociado, data_referencia=data_referencia)
    
    data_obs = calcular_data_pagamento(linha.operacao, validade, data_referencia)
    preencher_obs_interna(
        page,
        nome_motorista=linha.nome_motorista,
        placa=linha.placa,
        data_referencia=data_obs,
    )

    clicar_cadastrar_e_aguardar(page)


def executar_passo_2_lote(
    usuario: str,
    senha: str,
    planilha_path: str,
    validade: str,
    data_referencia: str,
    max_rows_to_scan: int = 100,
    artifacts_path: str | None = None,
) -> None:
    print("[stage] inicio_leitura_planilha")
    linhas = carregar_linhas_para_automacao(
        planilha_path=planilha_path,
        data_referencia=data_referencia,
        header_row=3,
        max_rows_to_scan=max_rows_to_scan,
    )
    print("[stage] fim_leitura_planilha")

    if not linhas:
        print("Nenhuma linha com a coluna 'Número' preenchida foi encontrada no intervalo analisado.")
        return

    print(f"Total de linhas elegíveis para automação: {len(linhas)}")

    config = PlaywrightVPSConfig(headless=True, record_video_dir=artifacts_path)
    with PlaywrightVPSClient(config) as client:
        page = client.page
        try:
            realizar_login_na_sessao(page, usuario=usuario, senha=senha)

            for idx, linha in enumerate(linhas, start=1):
                print(
                    f"\\nProcessando linha {idx}/{len(linhas)} da planilha (excel row {linha.excel_row}, Número {linha.numero})"
                )
                preencher_formulario_linha(
                    page,
                    linha=linha,
                    validade=validade,
                    data_referencia=data_referencia,
                )
        except Exception as exc:
            screenshot_path = None
            try:
                screenshot_path = _capturar_screenshot_erro(page, artifacts_path)
            except Exception as screenshot_exc:
                print(f"[artifact] Falha ao salvar screenshot de erro: {screenshot_exc}")
            if screenshot_path:
                print(f"[artifact] Screenshot de erro salvo em: {screenshot_path}")
                setattr(exc, "artifact_screenshot_path", str(screenshot_path))
            raise

    print("Lote concluído.")


def executar_passo_2(
    usuario: str,
    senha: str,
    numero: str,
    validade: str,
    perfil: str,
    base: str,
    frete_negociado: str,
    data_referencia: str,
    nome_motorista: str,
    placa: str,
    operacao: str = "",
    artifacts_path: str | None = None,
) -> None:
    linha = LinhaAutomacao(
        numero=numero,
        nome_motorista=nome_motorista,
        placa=placa,
        perfil=perfil,
        base=base,
        operacao=operacao,
        frete_negociado=frete_negociado,
        excel_row=0,
    )

    config = PlaywrightVPSConfig(headless=True, record_video_dir=artifacts_path)
    with PlaywrightVPSClient(config) as client:
        page = client.page
        realizar_login_na_sessao(page, usuario=usuario, senha=senha)
        preencher_formulario_linha(page, linha=linha, validade=validade, data_referencia=data_referencia)


if __name__ == "__main__":
    usuario = os.getenv("LOGTUDO_USER", "ATUALIZARBI")
    senha = os.getenv("LOGTUDO_PASS", "sua_senha_aqui")

    planilha = os.getenv("LOGTUDO_PLANILHA")
    validade = os.getenv("LOGTUDO_VALIDADE")
    data_referencia = os.getenv("LOGTUDO_DATA_REFERENCIA")

    if planilha and validade and data_referencia:
        executar_passo_2_lote(
            usuario=usuario,
            senha=senha,
            planilha_path=planilha,
            validade=validade,
            data_referencia=data_referencia,
            max_rows_to_scan=100,
        )
    else:
        numero = os.getenv("LOGTUDO_NUMERO")
        perfil = os.getenv("LOGTUDO_PERFIL")
        base = os.getenv("LOGTUDO_BASE")
        frete_negociado = os.getenv("LOGTUDO_FRETE_NEGOCIADO")
        nome_motorista = os.getenv("LOGTUDO_NOME_MOTORISTA")
        placa = os.getenv("LOGTUDO_PLACA")
        operacao_env = os.getenv("LOGTUDO_OPERACAO", "")

        if not all(
            [numero, validade, perfil, base, frete_negociado, data_referencia, nome_motorista, placa]
        ):
            raise ValueError(
                "Para execução unitária, informe: numero, validade, perfil, base, frete_negociado, "
                "data_referencia, nome_motorista e placa (ou configure LOGTUDO_PLANILHA para lote)."
            )

        executar_passo_2(
            usuario=usuario,
            senha=senha,
            numero=numero,
            validade=validade,
            perfil=perfil,
            base=base,
            frete_negociado=frete_negociado,
            data_referencia=data_referencia,
            nome_motorista=nome_motorista,
            placa=placa,
            operacao=operacao_env,
        )
