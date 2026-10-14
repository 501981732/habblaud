<p align="center">
  <img src="client/public/assets/brand/logo-mark@4x.png" width="96" alt="Habblaud: prédio em pixel art" />
</p>

<h1 align="center">Habblaud</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <b>Português (Brasil)</b>
</p>

<p align="center">
  <b>Um escritório virtual para seus agentes de programação.</b><br />
  Uma sala para cada projeto, um personagem em pixel art para cada sessão.<br />
  Acompanhe Claude Code, Codex, DeepSeek Harness e Pi enquanto trabalham, esperam por você e concluem tarefas.
</p>

<p align="center">
  <img alt="Node.js 22.19+" src="https://img.shields.io/badge/Node.js-%E2%89%A522.19-5fa04e?logo=node.js&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" />
  <img alt="Interface: chinês simplificado e português brasileiro" src="https://img.shields.io/badge/UI-zh--CN%20%7C%20pt--BR-4aa8e8" />
  <img alt="Licença MIT" src="https://img.shields.io/badge/License-MIT-f08a3c" />
</p>

<p align="center">
  <a href="#instalação">Início rápido</a> ·
  <a href="#conecte-seus-agentes">Configurar agentes</a> ·
  <a href="docs/zh-CN/接入与故障排查.md">Guia de integração (中文)</a> ·
  <a href="https://github.com/501981732/habblaud">Código-fonte</a> ·
  <a href="LICENSE">Licença</a>
</p>

<p align="center">
  <img src="docs/screenshots/zh-CN/office.gif" width="820" alt="Habblaud em chinês, com agentes trabalhando nas salas dos projetos" />
</p>

---

Quando você executa agentes em vários projetos, é fácil perder de vista quem está fazendo o quê. O **Habblaud** transforma essas sessões em um escritório fácil de acompanhar: quem está digitando, quem precisa da sua aprovação, quem deixou um comando em execução e quem terminou. Abra a conversa de um personagem, envie a próxima instrução ou analise uma solicitação pendente na mesma página.

Entre uma tarefa e outra, o escritório ganha vida. Os personagens fazem pausas para café, assistem à TV, jogam e encontram os colegas. Essas animações acontecem no Habblaud; seus agentes continuam trabalhando normalmente.

O escritório funciona no seu computador. Claude Code e Codex usam registros locais das sessões; DSH e Pi se conectam por plugins nativos. A interface está disponível em **chinês simplificado e português brasileiro**, com chinês como idioma inicial. Altere o idioma em Configurações → Idioma. Prompts, comandos, caminhos, nomes de modelos e resultados das ferramentas mantêm o texto original.

## Sumário

- [Como é](#como-é)
- [Agentes compatíveis](#agentes-compatíveis)
- [Instalação](#instalação)
- [Conecte seus agentes](#conecte-seus-agentes)
- [Use o escritório](#use-o-escritório)
- [Configuração](#configuração)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Atualização e desinstalação](#atualização-e-desinstalação)
- [Solução de problemas](#solução-de-problemas)
- [Desenvolvimento](#desenvolvimento)
- [Créditos e licença](#créditos-e-licença)

## Como é

- **Salas e personagens:** projetos ativos ganham suas próprias salas. Agentes principais e subagentes compatíveis chegam pelo elevador, trabalham nas mesas e vão embora quando as sessões terminam.
- **Atividade em tempo real:** veja ferramentas, arquivos, pesquisas, comandos, tarefas e atividades recentes. O rótulo do runtime aparece separado do modelo.
- **Conversas e histórico:** leia conversas atuais e sessões encerradas recentemente, incluindo chamadas e resultados de ferramentas, pela interface web local.
- **Mensagens e aprovações:** envie instruções aos agentes conectados e responda às solicitações compatíveis com cada runtime. Personagens esperando por você levantam a mão.
- **Comandos em segundo plano:** enquanto um comando de shell está em execução, o agente permanece na mesa e mostra o tempo decorrido e o resultado ou falha.
- **Uso e “Meu dia”:** veja limites disponíveis, tokens, custos e tempo de trabalho por projeto, conta ou agente.
- **Reprodução da linha do tempo:** reveja o dia no escritório. Por padrão, os resumos ficam guardados por sete dias.
- **Eventos do GitHub:** pushes, PRs, CI e releases bem-sucedidos podem gerar comemorações; falhas podem gerar alertas.
- **Vida social:** personagens ociosos conversam, tomam café, assistem à TV, jogam e criam amizades ou rivalidades.
- **Desktop e celular:** reorganize salas, renomeie projetos, personalize personagens e use painéis em telas menores. Som e notificações do navegador são opcionais.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/agent-details.png" alt="Detalhes do agente com tarefas, subagentes, atividade e estatísticas" /></td>
    <td width="50%"><img src="docs/screenshots/night.png" alt="Escritório à noite, com salas iluminadas e luzes no corredor" /></td>
  </tr>
  <tr>
    <td><b>Detalhes do agente.</b> Tarefas, subagentes, atividade e estatísticas em um painel.</td>
    <td><b>Dia e noite.</b> O céu e a iluminação do escritório acompanham a hora local.</td>
  </tr>
</table>

> As capturas usam projetos, agentes e contas fictícios de demonstração. A animação acima mostra a interface em chinês; as capturas de detalhes e da noite mostram a interface em português. Mais imagens: [escritório em chinês](docs/screenshots/zh-CN/office.jpg), [configurações](docs/screenshots/zh-CN/settings.jpg), [ajuda](docs/screenshots/zh-CN/help.jpg) e [escritório no celular](docs/screenshots/zh-CN/mobile-office.jpg).

## Agentes compatíveis

| Recurso | Claude Code | Codex | DeepSeek Harness (DSH) | Pi |
| --- | --- | --- | --- | --- |
| Salas, status online, atividade e conversas | Sessões locais; plugin adiciona sinais em tempo real | Sessões locais; hooks adicionam sinais em tempo real | Plugin nativo Cordis | Extensão nativa |
| Sessões recentes e histórico de conversas | Transcrições locais | Arquivos locais das sessões | Consulta nativa de sessões DSH, com cache na ponte | JSONL do ramo atual da sessão Pi |
| Envio de mensagem pela interface web | Plugin de mensagens | Comando local `codex queue` | Controlador nativo da sessão | Extensão nativa |
| Aprovações pela interface web | Plugin de permissões | Hooks | Callback nativo; usa a interface web do DSH se desconectado | Aprovação opcional de ferramentas, desativada por padrão |
| Uso | Limites de 5 horas e semanais e tokens | Limites e tokens fornecidos pelo Codex | Tokens informados pelo DSH; preços e limites desconhecidos não são estimados | Tokens e custos informados pelo Pi; valores desconhecidos não são estimados |

Claude Code, Codex, DSH e Pi são **runtimes** de agentes. GLM, DeepSeek e nomes semelhantes são **modelos** escolhidos dentro de um runtime. Uma sessão DSH usando GLM mostra DSH como origem e GLM como modelo. Os botões só aparecem quando a sessão oferece o recurso correspondente. O histórico em cache continua disponível quando um plugin está offline; sessões desconectadas ficam marcadas como offline.

## Instalação

Você precisa do Node.js **22.19 ou mais recente**, npm e pelo menos um runtime de agente local. O SDK do Pi requer Node.js ≥22.19.0. macOS e Linux podem executar diretamente com Node. Use o modo Node na mesma máquina para DSH/Pi. O suporte a Docker e Windows para essas integrações nativas ainda não foi verificado.

```bash
git clone https://github.com/501981732/habblaud.git
cd habblaud
npm ci
npm run build
npm start
```

Abra <http://127.0.0.1:4747>. Por padrão, o servidor escuta apenas na interface local de loopback. Para desenvolvimento, execute `npm run dev` e inicie o servidor com recarga automática. Se a porta estiver ocupada, use `HABBLAUD_PORT=4848 npm start`; depois de mudar a porta, configure os hooks e plugins do Codex para usar a mesma porta.

Para conhecer a interface primeiro, execute `npm run demo` ou ative o modo de demonstração em Configurações depois de iniciar o servidor. Agentes, conversas e contas de demonstração são fictícios e podem aparecer junto das sessões reais.

## Conecte seus agentes

### Claude Code

Se você tem sessões locais do Claude Code, o Habblaud pode ler os registros locais e mostrar salas, atividade, histórico e terminais. Recomendamos instalar os plugins para consultar o uso, receber sinais de espera em tempo real, enviar mensagens pela web e tratar aprovações:

```bash
npm run mod:install
npm run mod:status
```

`mod:install` usa os comandos oficiais de plugins do Claude Code para instalar o mod observador e os plugins de permissões e mensagens nas contas detectadas. Ele faz backup da configuração antes de alterá-la. Use `-- --sem-permissoes` ou `-- --sem-mensagens` para não instalar o plugin correspondente. Versões antigas do Claude Code podem usar `npm run usage:install` e `npm run hooks:install` separadamente. Consulte o [guia dos plugins do Claude (中文)](mod/README.md).

Para sessões do Claude Code já abertas, execute `/reload-plugins` ou reabra a sessão para carregar os plugins. O comando `/habblaud` do plugin mostra um resumo do escritório no terminal. Por padrão, os diretórios das contas são encontrados em `CLAUDE_CONFIG_DIR` e `~/.claude*`; você também pode definir `HABBLAUD_CLAUDE_DIRS`.

### Codex

As sessões do Codex CLI/Desktop são encontradas em `~/.codex`, `CODEX_HOME` ou diretórios `~/.codex*` detectados automaticamente. É possível ler sessões existentes sem hooks. Para ver etapas com menos atraso e tratar aprovações pela interface web:

```bash
npm run codex:install
npm run codex:status
```

Aprove os novos hooks em `/hooks` no Codex e reabra as sessões afetadas. O instalador adiciona apenas os hooks do Habblaud, faz backup da configuração existente e preserva outros hooks. As mensagens enviadas pela web usam o comando local `codex queue`. Se o comando não estiver no `PATH`, defina `HABBLAUD_CODEX_BIN=/caminho/absoluto/codex`. Defina `HABBLAUD_CODEX_DIRS` (separados por vírgulas) para diretórios personalizados de contas; defina `HABBLAUD_CODEX=0` para desativar essa origem.

### DeepSeek Harness (DSH)

O DSH requer um plugin nativo. Ele lê o estado e o histórico decodificado do processo DSH, envia mensagens pelo controlador nativo da sessão e trata aprovações em tempo real quando uma página local do Habblaud está aberta. A interface web do DSH continua disponível; se a ponte se desconectar ou nenhuma página do Habblaud estiver aberta, as aprovações voltam para a interface web do DSH.

Inicie o serviço Node do Habblaud descrito acima, abra o painel e clique em **Conectar DSH** na barra superior ou em **Configurações → Integrações**. O Habblaud detecta o DSH local, instala a ponte e a habilita no perfil selecionado. Se houver vários perfis, escolha um nas configurações. Não é necessário executar um comando de instalação da ponte nem ativar o plugin separadamente no DSH.

O painel distingue **ponte habilitada** de **DSH conectado**. Abra o DSH após a instalação; se ele já está rodando e ainda não carregou a ponte, espere a tarefa atual terminar e reinicie o DSH uma vez. As próximas inicializações carregam a ponte automaticamente, e ela se reconecta quando o Habblaud reinicia. O botão não reinicia tarefas DSH em andamento.

A instalação por linha de comando e os caminhos personalizados continuam disponíveis. O exemplo usa o perfil comum `web`:

```bash
npm run dsh:install -- --profile web
npm run dsh:status -- --profile web
```

O instalador adiciona o plugin compilado localmente pelo comando oficial `dsh plugin` e faz backup dos arquivos de configuração alterados. O botão também reativa esta ponte quando está desabilitada, preservando os outros plugins e configurações. Se `dsh` não estiver no `PATH` nem no cache npm local, defina `HABBLAUD_DSH_BIN=/caminho/absoluto/dsh` antes de iniciar o Habblaud. Na linha de comando, use `--dsh /caminho/absoluto/dsh` e `--dsh-home /diretório` para caminhos personalizados. O DSH continua gerenciando o próprio modelo, a autenticação e o diretório de trabalho. A conexão pelo botão requer o serviço Node local; fica indisponível no Docker ou com a origem DSH ou o terminal local desabilitados.

O Habblaud gera uma configuração local e privada para a ponte do plugin, por padrão em `~/.habblaud/bridge.json`. **Não faça commit desse arquivo nem cole seu conteúdo em uma issue.** Se você usa um diretório de dados separado ou várias instâncias do Habblaud, defina o mesmo `HABBLAUD_BRIDGE_CONFIG=/caminho/absoluto/bridge.json` para o servidor e o processo DSH. Remova o plugin com `npm run dsh:uninstall -- --profile web`. Consulte o [guia do DSH (中文)](integrations/dsh/README.md).

O DSH mantém o controle da configuração do modelo e da autenticação, inclusive para modelos GLM ou DeepSeek. O Habblaud mostra o runtime e o modelo selecionado separadamente.

### Pi

O Pi se conecta por uma extensão nativa. Depois de compilar, carregue explicitamente a extensão no processo Pi que deseja acompanhar. O serviço Habblaud deve estar em execução na mesma máquina:

```bash
pi --extension /caminho/absoluto/habblaud/integrations/pi/dist/index.js
```

A extensão acompanha eventos de sessão, ferramentas e mensagens do processo Pi atual. Para consultar o histórico, ela lê os arquivos JSONL da sessão Pi e reconstrói a conversa seguindo o ramo atual. O diretório padrão é `sessions/` dentro de `PI_CODING_AGENT_DIR` ou `~/.pi/agent`. Para usar vários diretórios de dados, defina `HABBLAUD_PI_DIRS` como uma lista de **diretórios de agente Pi**: use `:` no macOS/Linux e `;` no Windows. O código procura `sessions/` dentro de cada diretório.

A aprovação de ferramentas do Pi fica **desativada por padrão**. Para tratar cada chamada de ferramenta Pi pela interface web, defina `HABBLAUD_PI_APPROVALS=1` antes de iniciar o Pi. Se a ponte local não estiver disponível, a aprovação volta para a própria interface de confirmação do Pi. A ausência de interface interativa, o cancelamento ou o tempo esgotado nunca concedem aprovação automaticamente. A interface web oferece apenas permitir ou negar uma vez; ela não tem a opção “sempre permitir” nem sugestões de perguntas do Claude Code. Consulte o [guia da extensão Pi (中文)](integrations/pi/README.md).

A extensão Pi foi verificada com o SDK oficial quanto ao carregamento e aos eventos; uma solicitação real a um modelo Pi ainda não foi verificada. Consulte o [registro de validação (中文)](docs/zh-CN/验证记录.md) para ver o escopo testado dos quatro runtimes.

### Docker e acesso pela rede local

Para Claude Code/Codex, use `npm run docker:up`, `npm run docker:logs` e `npm run docker:down`; o container monta os diretórios de sessão necessários somente para leitura. Para enviar mensagens ao Codex pela web no modo container, execute também `npm run codex:bridge` no host. Use o modo Node para DSH/Pi; suas pontes nativas ainda não foram verificadas no Docker.

Se você disponibilizar a página na rede local com `HABBLAUD_HOST=0.0.0.0` ou `HABBLAUD_BIND=0.0.0.0` no Docker, terminais, histórico de conversas, mensagens pela web, aprovações, edição de personagens e pontes nativas serão desativados. O status do escritório, somente para leitura, continua disponível; conteúdo e ações sensíveis só são habilitados pelo acesso local de loopback.

## Use o escritório

### Salas e personagens

Clique em um personagem para abrir seus detalhes, tarefas, subagentes e atividade. Arraste as salas e os agentes principais na barra lateral para reorganizá-los; clique com o botão direito em uma sala para renomeá-la. O lápis nos detalhes de um agente principal permite mudar seu nome e aparência. Essas configurações ficam no diretório de dados do Habblaud.

Agentes do mesmo projeto podem compartilhar uma sala, mesmo em runtimes diferentes. Quando a última sessão termina, as luzes se apagam e a sala vira um jardim até outra sessão chegar. Os estados `working`, `idle`, `waiting` e `shell` indicam trabalho ativo, inatividade, uma solicitação que espera sua resposta e um comando em segundo plano em execução. Sessões DSH/Pi desconectadas ficam offline, mas o histórico em cache continua disponível para leitura.

### Conversas, mensagens e aprovações

Abra uma conversa nos detalhes do agente. O histórico inclui mensagens do usuário, respostas, ferramentas e resultados; conversas longas têm limites de quantidade e tamanho de entradas. Prompts e resultados de ferramentas mantêm o idioma original.

Envie a próxima instrução pelos detalhes ou pelo painel da conversa. O envio aparece como enfileirado, entregue ou com falha. **Entregue significa que o runtime aceitou a mensagem**, não que o modelo concluiu a tarefa. Uma mensagem enfileirada pode esperar o turno atual terminar. Confirme o diretório de trabalho e o modelo antes de enviar.

Os controles de aprovação só aparecem para solicitações pendentes compatíveis com o runtime conectado. Se você responder no terminal original ou na interface web do DSH, o escritório remove a solicitação. Uma página fechada, ponte desconectada, solicitação cancelada ou tempo esgotado devolve o controle ao fluxo nativo ou nega a solicitação; nunca concede aprovação automaticamente. A configuração opcional de aprovação do Pi está [descrita acima](#pi).

### Contas, uso e reprodução

O uso da conta aparece quando a origem fornece esses dados. Claude Code pode informar limites de 5 horas e semanais; Codex informa os próprios limites. DSH/Pi informam os tokens e custos disponíveis, sem substituir limites da assinatura Claude nem estimar preços desconhecidos.

“Meu dia” agrupa tempo de trabalho observado, espera, ferramentas, tokens e custos disponíveis por projeto, conta e agente. Plugins offline e custos indisponíveis podem deixar lacunas; essas estatísticas não equivalem a uma fatura da plataforma do modelo.

A reprodução da linha do tempo registra resumos do escritório, não conversas completas. A retenção padrão é de sete dias. Defina `HABBLAUD_TIMELINE=0` para interromper a gravação ou execute `npm run demo:timeline` para experimentar dados fictícios de reprodução.

### Vida social

Personagens ociosos se encontram no lounge e na copa, assistem à TV, jogam videogame ou pingue-pongue e disputam jokenpô. Personalidades, amizades, rivalidades e moedas fictícias deixam o escritório movimentado entre as tarefas. Veja a [animação do lounge](docs/screenshots/social-lounge.gif).

## Configuração

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | Porta HTTP |
| `HABBLAUD_HOST` | `127.0.0.1` | Endereço de escuta do Node; recursos sensíveis são desativados em endereços que não sejam loopback |
| `HABBLAUD_DATA_DIR` | `~/.habblaud` | Dados de salas/personagens, estatísticas, reprodução e cache da ponte nativa |
| `HABBLAUD_BRIDGE_CONFIG` | `<HABBLAUD_DATA_DIR>/bridge.json` | Configuração local da ponte DSH/Pi; se não for definida explicitamente para o plugin, ele lê `~/.habblaud/bridge.json` |
| `HABBLAUD_CLAUDE_DIRS` | Detectado automaticamente | Diretórios das contas Claude Code, separados por vírgulas |
| `HABBLAUD_CODEX_DIRS` | Detectado automaticamente | Diretórios das contas Codex, separados por vírgulas |
| `HABBLAUD_CODEX_BIN` | `codex` no `PATH` | Comando da fila de mensagens do Codex |
| `HABBLAUD_DSH` / `HABBLAUD_PI` | Ativado | Defina um deles como `0` para desativar essa origem |
| `HABBLAUD_PI_DIRS` | Diretório padrão do agente Pi | Vários diretórios de agente Pi, separados por `path.delimiter` do sistema |
| `HABBLAUD_PI_APPROVALS` | Desativado | Defina como `1` no processo Pi para assumir as aprovações de ferramentas |
| `HABBLAUD_TERMINAL` | Ativado para acesso local | Defina como `0` para desativar recursos sensíveis, como conversas, aprovações e mensagens |
| `HABBLAUD_MENSAGENS` | Segue a configuração do terminal | Defina como `0` para desativar apenas mensagens pela web |
| `HABBLAUD_TIMELINE` | Ativado | Defina como `0` para parar de gravar a linha do tempo |
| `HABBLAUD_UPDATE_CHECK` | Ativado | Defina como `0` para desativar consultas de releases do GitHub |
| `HABBLAUD_DEMO` | Desativado | Defina como `1` para iniciar com personagens de demonstração |

O caminho padrão de `HABBLAUD_BRIDGE_CONFIG` depende do diretório de dados. Se o servidor usa um `HABBLAUD_DATA_DIR` temporário enquanto um processo DSH/Pi em execução ainda lê `~/.habblaud/bridge.json`, eles não se conectarão. Configure os dois lados para ler o mesmo caminho antes de iniciar o processo do plugin. Não inclua o token da ponte na linha de comando, em logs, capturas de tela ou no repositório.

## Privacidade e segurança

O Habblaud lê registros locais de sessões e eventos nativos; não envia suas conversas a um serviço externo. Quando ativadas, as consultas de atualização acessam a API pública do GitHub; defina `HABBLAUD_UPDATE_CHECK=0` para desativá-las.

Conversas, mensagens pela web, aprovações, edição de personagens e a ponte nativa só ficam disponíveis pelo acesso local de loopback. Ao expor a página em um endereço que não seja loopback, o status somente para leitura continua disponível e os recursos sensíveis são desativados. A ponte nativa também exige um token privado e valida Host, Origin, propriedade da origem, tamanho e sequência dos eventos.

Dados de salas, estatísticas, resumos da linha do tempo e caches do histórico nativo ficam no diretório de dados local. **Mantenha `bridge.json` privado** e evite publicar capturas de conversas reais. O histórico DSH usa a consulta de sessões decodificadas do runtime; o histórico Pi segue apenas o ramo atual da árvore da sessão.

Consulte o [guia do servidor (中文)](server/README.md) para endpoints da API e limites do cache, e o [protocolo da ponte nativa](shared/native-bridge.ts) para os campos de integração.

## Atualização e desinstalação

Depois de atualizar o código, execute `npm ci && npm run build` e reinicie o Habblaud. Se o caminho ou a versão do plugin Claude Code tiver mudado, execute novamente `npm run mod:install`; no Codex, execute `npm run codex:status`; no DSH, execute `npm run dsh:status -- --profile web` e reinstale se o local compilado mudou. O comando de inicialização do Pi deve apontar para o `integrations/pi/dist/index.js` atual.

```bash
npm run mod:uninstall
npm run codex:uninstall
npm run dsh:uninstall -- --profile web
```

Esses comandos removem apenas os plugins ou hooks adicionados pelo Habblaud. Desative a extensão Pi removendo o argumento `--extension` ao iniciar o Pi. `npm run docker:down` apenas interrompe o container.

Instalações de versões antigas do CodeTown agora usam variáveis de ambiente `HABBLAUD_*`; as variáveis `CODETOWN_*` não funcionam mais. Para migrar os dados e substituir plugins antigos, consulte [Migrando do CodeTown](#vindo-do-codetown). Faça backup de capturas, exportações e outros arquivos salvos no antigo diretório de dados antes de atualizar.

#### Vindo do CodeTown

O Habblaud se chamava **CodeTown** até a versão 0.3.2. Depois de atualizar o repositório, execute uma vez:

```bash
git pull
npm ci
npm run mod:install
npm run docker:up
```

- **Plugins Claude Code:** até executar `mod:install`, as contas do Claude Code podem reclamar do marketplace `codetown`. O instalador troca os plugins antigos pelos do Habblaud e faz backup da configuração.
- **Docker:** `docker:up` substitui o container CodeTown e copia os dados do volume antigo. O volume anterior `codetown_codetown-data` permanece intacto. Depois de confirmar que os nomes dos personagens foram migrados, você pode removê-lo com `docker volume rm codetown_codetown-data` e apagar a imagem antiga com `docker image rm codetown:local`. Para as pontes nativas DSH/Pi, use o modo Node descrito acima; o Docker ainda não foi validado para elas.
- **Diretório local:** `~/.codetown` passa para `~/.habblaud` automaticamente nos fluxos de migração compatíveis do servidor e dos instaladores.
- **Navegador:** preferências e moedas passam para as novas chaves quando a página é aberta pela primeira vez.
- **Variáveis:** `CODETOWN_*` deixou de funcionar; renomeie-as para `HABBLAUD_*`. Para acesso pela rede, use a configuração atual `HABBLAUD_HOST` (Node) ou `HABBLAUD_BIND` (Docker).
- **Repositório:** o endereço correto é `https://github.com/501981732/habblaud.git`. Para atualizar a origem do clone: `git remote set-url origin https://github.com/501981732/habblaud.git`. A pasta local pode manter o nome antigo.
- **Node.js:** o modo Node exige a versão 22.19 ou mais recente.
- Backups `settings.json` criados antes da migração continuam com o padrão `settings.json.codetown-backup-<data>`.

## Solução de problemas

**Os agentes não aparecem:** confirme que a sessão real já produziu uma mensagem e que o processo correspondente carregou seu plugin/extensão. Para Claude Code/Codex, verifique os diretórios das contas; para DSH, confira o perfil e `dsh:status`; para Pi, confirme que `--extension` aponta para o arquivo compilado. `GET /api/health` mostra o estado do serviço e as origens ativadas.

**Mensagens/aprovações indisponíveis:** confirme que a página foi acessada por `127.0.0.1` ou `localhost`, que o servidor escuta em loopback e que `HABBLAUD_TERMINAL` e `HABBLAUD_MENSAGENS` estão ativados. O Codex precisa de um comando `codex` executável; Claude Code precisa do plugin; DSH/Pi precisam de uma ponte em execução. Aprovações Pi também exigem `HABBLAUD_PI_APPROVALS=1`.

**Histórico DSH ou Pi vazio:** o DSH precisa ler o histórico decodificado pela consulta nativa de sessões; arquivos comprimidos não podem ser tratados diretamente como JSONL. Para Pi, confirme que `PI_CODING_AGENT_DIR` / `HABBLAUD_PI_DIRS` aponta para diretórios de agente Pi, que os arquivos podem ser lidos e que são sessões reais dos últimos sete dias. Um processo nativo desconectado não mantém uma sessão antiga marcada como online.

**Conflito de porta ou acesso pela rede:** altere `HABBLAUD_PORT` e reconfigure os plugins. Páginas acessadas pela rede mantêm apenas o status do escritório para leitura; nomes Host permitidos não reativam operações sensíveis.

Para verificações específicas de cada origem e configuração da ponte local, consulte [Conexão e solução de problemas dos quatro runtimes de agentes (中文)](docs/zh-CN/接入与故障排查.md).

## Desenvolvimento

```bash
npm run dev
npm run typecheck
npm test
npm run build
```

O servidor TypeScript combina fontes de arquivos locais e eventos da ponte nativa em um snapshot do escritório; o cliente recebe atualizações por SSE. Os adaptadores dos runtimes ficam em `integrations/dsh` e `integrations/pi`. Para inspecionar uma instância local, comece por `GET /api/health` e `GET /api/snapshot`.

| Documentação | Conteúdo |
| --- | --- |
| [Integração e solução de problemas (中文)](docs/zh-CN/接入与故障排查.md) | Configuração dos runtimes e verificações da ponte local |
| [Servidor (中文)](server/README.md) | Origens, APIs HTTP/SSE, armazenamento e segurança |
| [Plugins Claude (中文)](mod/README.md) | Plugins de uso, mensagens e permissões |
| [DSH (中文)](integrations/dsh/README.md) / [Pi (中文)](integrations/pi/README.md) | Adaptadores nativos dos runtimes |
| [Recursos e imagens chinesas (中文)](docs/zh-CN/素材与中文图片.md) | Pipeline de pixel art e capturas de tela |
| [Registro de validação (中文)](docs/zh-CN/验证记录.md) | Escopo real de integração e testes locais |
| [Registro de alterações](CHANGELOG.md) | Mudanças do projeto |

## Créditos e licença

Habblaud foi criado por [marmottajr](https://github.com/marmottajr/habblaud). Este repositório acrescenta localização em chinês e integrações nativas com DSH/Pi, mantendo o escritório em pixel art e o suporte a Claude Code/Codex. Distribuído sob a [Licença MIT](LICENSE).
