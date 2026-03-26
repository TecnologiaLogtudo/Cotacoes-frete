from automacao.steps.passo2_cotacoes import executar_passo_2, executar_passo_2_lote


if __name__ == "__main__":
    import os

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
        )
