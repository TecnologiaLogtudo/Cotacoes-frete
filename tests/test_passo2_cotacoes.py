from automacao.steps.passo2_cotacoes import (
    normalizar_texto,
    _remetente_label_matches_base,
    calcular_data_pagamento,
    _encontrar_melhor_opcao,
)


def test_normalizar_texto_remove_acentos_e_maiusculas():
    assert normalizar_texto("Belém") == "BELEM"
    assert normalizar_texto("  Fortaleza ") == "FORTALEZA"


def test_remetente_label_matches_base_com_marcador_exato():
    label = (
        "02.012.862/0031-85 - TAM LINHAS AEREAS - FORTALEZA - "
        "AEROPORTO INTERNACIONAL PINTO MARTINS, 3000 - FORTALEZA / CE - IE: 69912980"
    )
    assert _remetente_label_matches_base(label, "FORTALEZA")


def test_remetente_label_matches_base_com_segmento_separado():
    label = "02.012.862/0031-85 - TAM LINHAS AEREAS - FORTALEZA/CE - IE: ISENTO"
    assert _remetente_label_matches_base(label, "FORTALEZA")


def test_calcular_data_pagamento_spot_ate_dia_15():
    # SPOT até dia 15 -> dia 25 do mesmo mês
    res = calcular_data_pagamento("SPOT", "10/05/2026", "01/01/2026")
    assert res == "25/05/2026"


def test_calcular_data_pagamento_spot_apos_dia_15():
    # SPOT após dia 15 -> dia 10 do mês seguinte
    res = calcular_data_pagamento("SPOT", "20/05/2026", "01/01/2026")
    assert res == "10/06/2026"


def test_calcular_data_pagamento_fixo():
    # FIXO -> dia 20 do mês seguinte
    res = calcular_data_pagamento("FIXO", "15/05/2026", "01/01/2026")
    assert res == "20/06/2026"


def test_calcular_data_pagamento_nilo():
    # MODO NILO -> dia 25 do mês seguinte
    res = calcular_data_pagamento("SPOT", "15/05/2026", "01/01/2026", is_nilo=True)
    assert res == "25/06/2026"


def test_calcular_data_pagamento_virada_de_ano():
    # SPOT em dezembro após dia 15 -> janeiro do ano seguinte
    res = calcular_data_pagamento("SPOT", "20/12/2025", "01/01/2025")
    assert res == "10/01/2026"


def test_encontrar_melhor_opcao_aprovada_com_html_real():
    opcoes = [
        {"value": "", "label": ""},
        {"value": "3", "label": "AG. RETORNO"},
        {"value": "2", "label": "APROVADA"},
        {"value": "9", "label": "CANCELADA"},
        {"value": "10", "label": "CUSTO LOGTUDO"},
        {"value": "5", "label": "FECHADA"},
        {"value": "1", "label": "REJEITADA"},
        {"value": "8", "label": "VINCULADA"},
    ]
    # Teste 1: Buscar "APROVADA"
    res1 = _encontrar_melhor_opcao(opcoes, "APROVADA")
    assert res1 is not None
    assert res1["value"] == "2"

    # Teste 2: Buscar "Aprovado Cliente" (fallback por prefixo / normalizado)
    res2 = _encontrar_melhor_opcao(opcoes, "Aprovado Cliente")
    assert res2 is not None
    assert res2["value"] == "2"


def test_obter_operacao_handler_registros():
    from automacao.operacoes import (
        obter_operacao_handler,
        OperacaoD2DHandler,
        OperacaoAmazonHandler,
        listar_operacoes_disponiveis,
    )
    import pytest

    handler_d2d = obter_operacao_handler("d2d")
    assert isinstance(handler_d2d, OperacaoD2DHandler)
    assert handler_d2d.codigo == "D2D"

    handler_amz = obter_operacao_handler("amazon")
    assert isinstance(handler_amz, OperacaoAmazonHandler)
    assert handler_amz.codigo == "AMAZON"

    with pytest.raises(ValueError, match="não suportada"):
        obter_operacao_handler("INEXISTENTE")

    ops = listar_operacoes_disponiveis()
    codigos = [op["codigo"] for op in ops]
    assert "D2D" in codigos
    assert "AMAZON" in codigos


def test_extrair_colunas_frete_d2d_e_amazon():
    from automacao.operacoes import OperacaoD2DHandler, OperacaoAmazonHandler
    import pytest

    h_d2d = OperacaoD2DHandler()
    col_val, col_neg = h_d2d.extrair_colunas_frete(None, 3, "05/11/2026", [15, 16])
    assert col_val == 15
    assert col_neg == 16

    with pytest.raises(ValueError, match="exige um par de colunas"):
        h_d2d.extrair_colunas_frete(None, 3, "05/11/2026", [15])

    h_amz = OperacaoAmazonHandler()
    col_val_amz, col_neg_amz = h_amz.extrair_colunas_frete(None, 3, "03/05/2026", [9])
    assert col_val_amz is None
    assert col_neg_amz == 9


def test_aplicar_tabela_e_fretes_d2d_fluxo_mock():
    from unittest.mock import MagicMock
    from automacao.operacoes import OperacaoD2DHandler
    from automacao.planilha import LinhaAutomacao

    page = MagicMock()
    locators = {}
    def get_locator(sel):
        if sel not in locators:
            locators[sel] = MagicMock()
        return locators[sel]
    page.locator.side_effect = get_locator
    selecionar_select = MagicMock()

    context = {
        "SEL_REGRA_FRETE": "sel_regra",
        "SEL_BOTAO_SUGERIR_TABELA": "btn_sugerir",
        "SEL_FRETE_NEGOCIADO": "campo_negociado",
        "SEL_VALOR_FRETE": "campo_valor_frete",
        "OPT_REGRA_FRETE_COTACAO_LATAM": "COTAÇÃO LATAM",
        "OPT_REGRA_FRETE_COTACAO_VAREJO": "COTAÇÃO VAREJO",
        "selecionar_opcao_select": selecionar_select,
    }

    linha = LinhaAutomacao(
        numero="5115512",
        nome_motorista="TAIRO NOVAIS",
        placa="PTP5512",
        perfil="FIORINO",
        base="IMPERATRIZ",
        operacao="FIXO",
        frete_negociado="200,00",
        excel_row=5,
        frete_valor="270,00",
    )

    handler = OperacaoD2DHandler()
    handler.aplicar_tabela_e_fretes(page, linha=linha, data_referencia="05/11/2026", context=context)

    # Verifica se primeiro selecionou COTAÇÃO LATAM
    assert selecionar_select.call_args_list[0][0][2] == "COTAÇÃO LATAM"

    # Verifica se clicou em sugerir tabela
    locators["btn_sugerir"].click.assert_called_once()

    # Verifica se depois alterou para COTAÇÃO VAREJO
    assert selecionar_select.call_args_list[1][0][2] == "COTAÇÃO VAREJO"

    # Verifica se preencheu Frete Valor com 270,00
    locators["campo_valor_frete"].fill.assert_called_once_with("270,00")

    # Verifica se preencheu Frete Negociado com 200,00
    locators["campo_negociado"].fill.assert_called_once_with("200,00")


def test_aplicar_tabela_e_fretes_amazon_fluxo_mock():
    from unittest.mock import MagicMock
    from automacao.operacoes import OperacaoAmazonHandler
    from automacao.planilha import LinhaAutomacao

    page = MagicMock()
    locators = {}
    def get_locator(sel):
        if sel not in locators:
            locators[sel] = MagicMock()
        return locators[sel]
    page.locator.side_effect = get_locator
    selecionar_select = MagicMock()

    context = {
        "SEL_REGRA_FRETE": "sel_regra",
        "SEL_BOTAO_SUGERIR_TABELA": "btn_sugerir",
        "SEL_FRETE_NEGOCIADO": "campo_negociado",
        "SEL_VALOR_FRETE": "campo_valor_frete",
        "OPT_REGRA_FRETE_COTACAO_LATAM": "COTAÇÃO LATAM",
        "OPT_REGRA_FRETE_COTACAO_VAREJO": "COTAÇÃO VAREJO",
        "selecionar_opcao_select": selecionar_select,
    }

    linha = LinhaAutomacao(
        numero="3052702",
        nome_motorista="EDLAILSON",
        placa="FCZ-2H02",
        perfil="3/4",
        base="FORTALEZA",
        operacao="FIXO",
        frete_negociado="500,00",
        excel_row=4,
        frete_valor="",
    )

    handler = OperacaoAmazonHandler()
    handler.aplicar_tabela_e_fretes(page, linha=linha, data_referencia="03/05/2026", context=context)

    # Verifica seleção de COTAÇÃO LATAM apenas uma vez
    assert len(selecionar_select.call_args_list) == 1
    assert selecionar_select.call_args_list[0][0][2] == "COTAÇÃO LATAM"

    # Clicou em sugerir tabela
    locators["btn_sugerir"].click.assert_called_once()

    # Preencheu apenas frete negociado
    locators["campo_negociado"].fill.assert_called_once_with("500,00")
    assert "campo_valor_frete" not in locators or not locators["campo_valor_frete"].fill.called


def test_carregar_linhas_d2d_real_se_existir():
    from pathlib import Path
    from automacao.planilha import carregar_linhas_para_automacao

    path_d2d = Path(r"D:\Logtudo\Docs\COT D2D 04-11.xlsx")
    if not path_d2d.exists():
        return

    linhas = carregar_linhas_para_automacao(
        planilha_path=str(path_d2d),
        data_referencia="05/11/2026",
        tipo_operacao="D2D",
        max_rows_to_scan=15,
    )
    assert len(linhas) >= 1
    # Verifica a linha do TAIRO NOVAIS
    tairo = next((l for l in linhas if l.numero == "5115512"), None)
    assert tairo is not None
    assert tairo.frete_valor == "270,00"
    assert tairo.frete_negociado == "200,00"
    assert tairo.perfil == "FIORINO"
    assert tairo.base == "IMPERATRIZ"


def test_carregar_linhas_amazon_real_se_existir():
    from pathlib import Path
    from automacao.planilha import carregar_linhas_para_automacao

    path_amz = Path("PLANILHA DE COTACAO NILO.xlsx")
    if not path_amz.exists():
        return

    linhas = carregar_linhas_para_automacao(
        planilha_path=str(path_amz),
        data_referencia="03/05/2026",
        tipo_operacao="AMAZON",
        max_rows_to_scan=5,
    )
    assert len(linhas) >= 1
    l1 = linhas[0]
    assert l1.numero == "3052702"
    assert l1.frete_valor == ""
    assert l1.frete_negociado == "500,00"



