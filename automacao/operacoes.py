from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Tuple


class BaseOperacaoHandler(ABC):
    """Classe base para estratégias operacionais de cotação de frete.
    
    Permite desacoplar as variações de layout de planilha e regras de negócio
    do formulário web do fluxo principal de automação.
    """

    codigo: str
    nome: str
    descricao: str

    @abstractmethod
    def extrair_colunas_frete(
        self,
        ws: Any,
        header_row: int,
        data_referencia: str,
        colunas_data: List[int],
    ) -> Tuple[int | None, int]:
        """Extrai as colunas de frete a partir das colunas de data encontradas.
        
        Retorna:
            (coluna_frete_valor, coluna_frete_negociado)
        """
        pass

    @abstractmethod
    def aplicar_tabela_e_fretes(
        self,
        page: Any,
        linha: Any,
        data_referencia: str,
        context: Dict[str, Any],
    ) -> None:
        """Executa a sequência de seleção da regra de frete, cálculo e preenchimento
        dos valores de frete no formulário web.
        """
        pass


class OperacaoAmazonHandler(BaseOperacaoHandler):
    """Operação Amazon:
    - Planilha possui 1 coluna para a data de referência.
    - Seleciona Regra COTAÇÃO LATAM -> Sugerir tabela de preços -> Preenche Frete Negociado.
    """

    codigo = "AMAZON"
    nome = "Operação Amazon"
    descricao = "Regra Cotação LATAM + Sugerir Tabela + Frete Negociado"

    def extrair_colunas_frete(
        self,
        ws: Any,
        header_row: int,
        data_referencia: str,
        colunas_data: List[int],
    ) -> Tuple[int | None, int]:
        if not colunas_data:
            raise ValueError(f"Nenhuma coluna encontrada para a data '{data_referencia}'.")
        # Na Amazon, a primeira coluna correspondente é o Frete Negociado; Frete Valor não é preenchido
        return (None, colunas_data[0])

    def aplicar_tabela_e_fretes(
        self,
        page: Any,
        linha: Any,
        data_referencia: str,
        context: Dict[str, Any],
    ) -> None:
        selecionar_select = context["selecionar_opcao_select"]
        sel_regra = context["SEL_REGRA_FRETE"]
        opt_latam = context["OPT_REGRA_FRETE_COTACAO_LATAM"]
        sel_btn_sugerir = context["SEL_BOTAO_SUGERIR_TABELA"]
        sel_frete_neg = context["SEL_FRETE_NEGOCIADO"]

        print(f"Selecionando Regra de frete: {opt_latam}...")
        selecionar_select(page, sel_regra, opt_latam, nome_campo="Regra de frete")

        print("Clicando em Sugerir tabela de preços...")
        page.locator(sel_btn_sugerir).click()
        page.wait_for_timeout(800)

        print(f"Preenchendo Frete Negociado para data '{data_referencia}': {linha.frete_negociado}")
        page.locator(sel_frete_neg).fill(str(linha.frete_negociado))


class OperacaoD2DHandler(BaseOperacaoHandler):
    """Operação D2D:
    - Planilha possui coluna de data DUPLICADA (duas colunas consecutivas com a mesma data).
    - 1ª coluna = Frete Valor (input dados_valorFrete).
    - 2ª coluna = Frete Negociado (input dados_outrosValores[fn]).
    - Seleciona Regra COTAÇÃO LATAM -> Sugerir tabela de preços -> Aguarda carregamento ->
      Altera Regra para COTAÇÃO VAREJO -> Preenche Frete Valor -> Preenche Frete Negociado.
    """

    codigo = "D2D"
    nome = "Operação D2D"
    descricao = "Regra Cotação LATAM + Sugerir Tabela -> Cotação Varejo + Frete Valor + Frete Negociado"

    def extrair_colunas_frete(
        self,
        ws: Any,
        header_row: int,
        data_referencia: str,
        colunas_data: List[int],
    ) -> Tuple[int | None, int]:
        if len(colunas_data) < 2:
            raise ValueError(
                f"A Operação D2D exige um par de colunas (data duplicada) para a data '{data_referencia}', "
                f"mas foram encontradas apenas {len(colunas_data)} coluna(s)."
            )
        col_frete_valor = colunas_data[0]
        col_frete_negociado = colunas_data[1]
        return (col_frete_valor, col_frete_negociado)

    def aplicar_tabela_e_fretes(
        self,
        page: Any,
        linha: Any,
        data_referencia: str,
        context: Dict[str, Any],
    ) -> None:
        selecionar_select = context["selecionar_opcao_select"]
        sel_regra = context["SEL_REGRA_FRETE"]
        opt_latam = context["OPT_REGRA_FRETE_COTACAO_LATAM"]
        opt_varejo = context.get("OPT_REGRA_FRETE_COTACAO_VAREJO", "COTAÇÃO VAREJO")
        sel_btn_sugerir = context["SEL_BOTAO_SUGERIR_TABELA"]
        sel_frete_neg = context["SEL_FRETE_NEGOCIADO"]
        sel_frete_val = context["SEL_VALOR_FRETE"]

        # 1. Seleciona COTAÇÃO LATAM
        print(f"Selecionando Regra de frete inicial: {opt_latam}...")
        selecionar_select(page, sel_regra, opt_latam, nome_campo="Regra de frete")

        # 2. Clica em Sugerir tabela de preços
        print("Clicando em Sugerir tabela de preços...")
        page.locator(sel_btn_sugerir).click()

        # 3. Aguarda carregamento da tabela de preços
        print("Aguardando carregamento da tabela de preços sugerida...")
        page.wait_for_timeout(1500)

        # 4. Altera Regra de Frete para COTAÇÃO VAREJO (seleção por nome/rótulo)
        print(f"Alterando Regra de frete para: {opt_varejo}...")
        selecionar_select(page, sel_regra, opt_varejo, nome_campo="Regra de frete")
        page.wait_for_timeout(600)

        # 5. Adiciona o valor da 1ª coluna no campo Frete Valor
        if linha.frete_valor:
            print(f"Preenchendo Frete Valor (1ª coluna): {linha.frete_valor}")
            page.locator(sel_frete_val).fill(str(linha.frete_valor))
        else:
            print("Frete Valor vazio na planilha; mantendo valor padrão.")

        # 6. Preenche o campo Frete Negociado com o valor da 2ª coluna
        print(f"Preenchendo Frete Negociado (2ª coluna) para data '{data_referencia}': {linha.frete_negociado}")
        page.locator(sel_frete_neg).fill(str(linha.frete_negociado))


REGISTRO_OPERACOES: Dict[str, type[BaseOperacaoHandler]] = {
    "D2D": OperacaoD2DHandler,
    "AMAZON": OperacaoAmazonHandler,
}


def obter_operacao_handler(tipo: str | None = None) -> BaseOperacaoHandler:
    """Retorna a instância do handler para a operação especificada.
    Padrão caso não informado: D2D.
    """
    codigo = (tipo or "D2D").strip().upper()
    handler_cls = REGISTRO_OPERACOES.get(codigo)
    if not handler_cls:
        opcoes = ", ".join(REGISTRO_OPERACOES.keys())
        raise ValueError(f"Operação '{tipo}' não suportada. Opções disponíveis: {opcoes}")
    return handler_cls()


def listar_operacoes_disponiveis() -> List[Dict[str, str]]:
    """Lista metadados das operações registradas no sistema."""
    return [
        {
            "codigo": h.codigo,
            "nome": h.nome,
            "descricao": h.descricao,
        }
        for h in [cls() for cls in REGISTRO_OPERACOES.values()]
    ]
