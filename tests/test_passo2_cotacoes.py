from automacao.steps.passo2_cotacoes import normalizar_texto, _remetente_label_matches_base


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
