# FinGui

App simples de controle financeiro pessoal (PWA). Funciona no navegador do celular ou do computador e pode ser instalado na tela inicial.

## O que ele faz

- **Registro rápido**: botão **+** sempre visível. Abre com a data de hoje e o cursor no valor, para lançar o gasto assim que ele acontece.
- **Entradas e saídas**: salário, freelance etc. de um lado, gastos do outro. Mostra o saldo do mês.
- **Despesas fixas x variáveis**: cada gasto é marcado como fixo (aluguel, internet...) ou variável (mercado, Uber...), com uma barra mostrando a proporção.
- **Gastos por categoria**: ranking com valor e % de cada categoria, além de uma frase dizendo onde o gasto está mais concentrado.
- **Delivery**: categoria própria, com campo opcional de taxa de entrega. Mostra total gasto, nº de pedidos, ticket médio e quanto foi só de taxa.
- **Insights (gráficos)**: gasto médio por dia e projeção do mês, rosca de gastos por categoria, ritmo de gastos comparado ao mês anterior, variação por categoria, entradas x saídas em 6 meses, gastos por dia da semana e os 5 maiores gastos. Toque nos gráficos para ver os valores.
- **Copiar fixas**: um botão repete as despesas fixas do mês anterior no mês atual.
- **Lançamentos**: lista por dia, com filtros (tipo, fixa/variável, categoria) e busca. Toque num item para editar e na 🗑 para excluir.
- **Ajustes**: crie ou remova categorias, faça backup (JSON) e exporte para planilha (CSV, abre no Excel/Google Sheets).

## Como usar

Não precisa instalar nada: são só arquivos estáticos (`index.html`, `styles.css`, `app.js`).

- **No computador**: rode um servidor local na pasta (`python3 -m http.server`) e abra `http://localhost:8000`. Também dá para abrir o `index.html` direto, mas aí não funciona offline nem instala.
- **No celular**: publique a pasta (por exemplo no **GitHub Pages**: Settings → Pages → escolha a branch). Depois abra o link no celular e use "Adicionar à tela inicial". Ele passa a abrir como um app e funciona offline.

## Onde ficam os dados

Os dados ficam salvos **no próprio aparelho** (localStorage do navegador). Não há servidor nem conta. Por isso:
- dados do celular e do computador não se sincronizam;
- limpar os dados do navegador apaga os lançamentos. Use **Ajustes → Exportar backup** de tempos em tempos.
