from __future__ import annotations

import argparse
import os

from automacao.queue import enqueue_cotacao_job, fetch_job, serialize_job_result


def cmd_enqueue(args: argparse.Namespace) -> None:
    usuario = args.usuario or os.getenv("LOGTUDO_USER", "ATUALIZARBI")
    senha = args.senha or os.getenv("LOGTUDO_PASS", "")
    if not senha:
        raise ValueError("Informe --senha ou configure LOGTUDO_PASS.")

    task = enqueue_cotacao_job(
        usuario=usuario,
        senha=senha,
        planilha_path=args.planilha,
        validade=args.validade,
        data_referencia=args.data_referencia,
        max_rows_to_scan=args.max_rows,
    )
    print(f"Job enfileirado com sucesso. task_id={task.id}")


def cmd_status(args: argparse.Namespace) -> None:
    result = fetch_job(args.task_id)
    payload = serialize_job_result(result)
    print(f"task_id={args.task_id}")
    print(f"status={payload['status']}")
    if "result" in payload:
        print(f"result={payload['result']}")
    if "error" in payload:
        print(f"error={payload['error']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Gerenciador de jobs da automacao")
    sub = parser.add_subparsers(dest="command", required=True)

    enqueue = sub.add_parser("enqueue", help="Enfileira um job de cotacoes")
    enqueue.add_argument("--planilha", required=True, help="Caminho da planilha .xlsx")
    enqueue.add_argument("--validade", required=True, help="Validade para o formulario (ex.: 30/03/2026)")
    enqueue.add_argument("--data-referencia", required=True, help="Data para cruzamento no header da linha 3")
    enqueue.add_argument("--max-rows", type=int, default=100, help="Maximo de linhas para varrer")
    enqueue.add_argument("--usuario", help="Usuario do Logtudo (opcional)")
    enqueue.add_argument("--senha", help="Senha do Logtudo (opcional, pode usar LOGTUDO_PASS)")
    enqueue.set_defaults(func=cmd_enqueue)

    status = sub.add_parser("status", help="Consulta status do job")
    status.add_argument("--task-id", required=True, help="ID retornado no enqueue")
    status.set_defaults(func=cmd_status)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
