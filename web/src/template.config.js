export const templateConfig = {
  brand: {
    organization: 'LogTudo',
    product: 'Cotação de Frete',
    version: '1.2.0',
    subtitle: 'Faturamentos adicionais v1',
  },
  phases: [
    { id: 'F1', title: 'Leitura', subtitle: 'Sanitização Excel' },
    { id: 'F2', title: 'Login', subtitle: 'Sessão e-Login' },
    { id: 'F3', title: 'Cotação', subtitle: 'Busca & Extração' },
    { id: 'F4', title: 'Frete', subtitle: 'Dados do Motorista' },
    { id: 'F5', title: 'Contrato', subtitle: 'Emissão & Saldo' },
  ],
  upload: {
    title: 'Planilha de Cotação',
    help: 'Selecione ou arraste a planilha .xlsx (limite máximo de 100 MB) para validação prévia de cabeçalhos e dados.',
    accept: '.xlsx',
    maxSizeMB: 100,
    maxSizeBytes: 100 * 1024 * 1024,
  },
  operations: [
    {
      code: 'D2D',
      title: 'Operação D2D (Varejo)',
      tag: 'D2D',
      description: 'Regra LATAM → Varejo • Frete Valor + Frete Negociado',
    },
    {
      code: 'AMAZON',
      title: 'Operação Amazon (Latam)',
      tag: 'Amazon',
      description: 'Regra COTAÇÃO LATAM • Apenas Frete Negociado',
    },
  ],
  credentials: [
    { key: 'usuario', label: 'Usuário do Portal', type: 'text', required: true, placeholder: 'Usuário da plataforma' },
    { key: 'senha', label: 'Senha do Portal', type: 'password', required: true, placeholder: 'Senha da plataforma' },
  ],
  operationalFields: [
    { key: 'dataReferencia', label: 'Data da Cotação', type: 'date', required: true },
    { key: 'tipoOperacao', label: 'Tipo de Operação', type: 'select', defaultValue: 'D2D' },
  ],
  settings: [
    { key: 'throttleSeconds', label: 'Intervalo entre itens (s)', type: 'number', defaultValue: 2.5 },
    { key: 'headless', label: 'Executar em segundo plano (Headless)', type: 'checkbox', defaultValue: true },
  ],
}
