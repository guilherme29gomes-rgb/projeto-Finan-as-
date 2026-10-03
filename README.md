# FinGui

App simples de controle financeiro pessoal (PWA). Funciona no navegador do celular ou do computador e pode ser instalado na tela inicial.

## O que ele faz

- **Registro rápido**: botão **+** sempre visível. Abre com a data de hoje e o cursor no valor, para lançar o gasto assim que ele acontece.
- **Entradas e saídas**: salário, freelance etc. de um lado, gastos do outro. Mostra o saldo do mês.
- **Despesas fixas x variáveis**: cada gasto é marcado como fixo (aluguel, internet...) ou variável (mercado, Uber...), com uma barra mostrando a proporção.
- **Gastos por categoria**: ranking com valor e % de cada categoria, além de uma frase dizendo onde o gasto está mais concentrado.
- **Delivery**: categoria própria, com campo opcional de taxa de entrega. Mostra total gasto, nº de pedidos, ticket médio e quanto foi só de taxa.
- **Insights (gráficos)**: gasto médio por dia e projeção do mês, rosca de gastos por categoria, ritmo de gastos comparado ao mês anterior, variação por categoria, entradas x saídas em 6 meses, gastos por dia da semana e os 5 maiores gastos. Toque nos gráficos para ver os valores.
- **Fatura do cartão**: lance o valor total da fatura e vá adicionando manualmente cada gasto dela, com a categoria. O app mostra quanto falta lançar, sugere a categoria pela descrição (Uber → Transporte, Netflix → Assinaturas…) e lembra das suas escolhas. A tela "Racional da fatura" mostra para onde foi o dinheiro, e nos resumos e gráficos cada gasto conta na sua categoria real.
- **Gastos por cartão**: no Resumo, o quadro **Seus cartões neste mês** mostra, para cada cartão (Nubank, Itaú…), em que categoria você mais gasta, com barra por categoria e porcentagens. Em Insights, **Cartões nos últimos 6 meses** mostra o hábito de cada cartão no período (ex.: "Delivery foi a maior categoria em 5 de 6 faturas"). Compras em lojas da internet (Amazon, Mercado Livre, Shopee, Shein…) entram na categoria **Compras online**.
- **Despesas fixas mensais**: ao lançar um gasto como **Fixa** (com "Repetir todo mês"), ele entra sozinho em todos os meses seguintes. Se mudar de valor, edite em qualquer mês e a mudança vale dali em diante. Se deixar de existir, exclua e escolha **"Deixou de existir"** (ou use **Ajustes → Despesas fixas mensais → Encerrar**): ela some dos meses seguintes e continua registrada nos anteriores. Para pular só um mês, escolha **"Só deste mês"**.
- **Entradas a receber e projeção do mês**: lance valores que ainda vão entrar (adiantamento, salário, férias, 13º, bônus…) como **"A receber"**, avulsos ou repetindo todo mês. Eles não contam como dinheiro recebido até você tocar em **Recebi**. O painel **Projeção do mês** mostra o saldo de hoje e o saldo previsto no fim do mês (recebido + a receber − gastos − contas fixas a pagar), com opção de incluir uma estimativa dos gastos do dia a dia.
- **Contas do mês e vencimentos**: no Resumo, as contas fixas aparecem em ordem de vencimento (dia em destaque), com o status — vence em X dias, vence hoje, atrasada ou paga. Toque em **Pagar** para marcar como paga; o mês mostra quanto já foi pago e quanto falta. Quando há conta vencendo ou atrasada, um aviso aparece no topo.
- **Lembretes**: em Ajustes → Lembretes de vencimento, adicione as contas ao **calendário do celular** (evento mensal com alarme às 9h do vencimento, funciona com o app fechado) e/ou ative as **notificações do app** (ao abrir o app e, no Android com o app instalado, também em segundo plano). Opção de avisar 1 dia antes.
- **Lançamentos**: lista por dia, com filtros (tipo, fixa/variável, categoria) e busca. Toque num item para editar e na 🗑 para excluir.
- **Ajustes**: crie ou remova categorias, faça backup (JSON) e exporte para planilha (CSV, abre no Excel/Google Sheets).

## Como usar

Não precisa instalar nada: são só arquivos estáticos (`index.html`, `styles.css`, `app.js`).

- **No computador**: rode um servidor local na pasta (`python3 -m http.server`) e abra `http://localhost:8000`. Também dá para abrir o `index.html` direto, mas aí não funciona offline nem instala.
- **No celular**: publique a pasta (por exemplo no **GitHub Pages**: Settings → Pages → escolha a branch). Depois abra o link no celular e use "Adicionar à tela inicial". Ele passa a abrir como um app e funciona offline.

## Atualizações não apagam os dados

Os lançamentos ficam salvos no aparelho com a mesma chave desde a primeira versão; publicar uma versão nova do app **não apaga nada**. Além disso:
- antes de converter dados de uma versão antiga, o app guarda uma cópia do formato anterior;
- todo dia ele guarda uma **cópia automática** (Ajustes → Restaurar cópia automática);
- se os dados não puderem ser lidos, o conteúdo original é preservado à parte, nunca sobrescrito;
- com o app aberto em duas abas, uma não apaga o que a outra salvou;
- o app pede ao navegador armazenamento protegido e lembra você de salvar um backup a cada 7 dias.

## Onde ficam os dados

Os dados ficam salvos **no próprio aparelho** (localStorage do navegador). Não há servidor nem conta. Por isso:
- dados do celular e do computador não se sincronizam;
- limpar os dados do navegador apaga os lançamentos. Use **Ajustes → Exportar backup** de tempos em tempos.
