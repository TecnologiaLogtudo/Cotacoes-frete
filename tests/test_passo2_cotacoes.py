from automacao.steps.passo2_cotacoes import (
    normalizar_texto,
    _remetente_label_matches_base,
    calcular_data_pagamento,
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
