# Master Plan Atualizado: Copiloto de Orçamento (OrceIA)

**Documento Oficial de Roadmap e Arquitetura de Produto**

## 🎯 SPRINT 1: Fundação, Persistência e Entregável Rápido (Prioridade Zero)
*Objetivo: Eliminar a perda de dados no navegador, desvincular o sistema de arquivos locais e entregar um valor tangível imediato para o usuário.*

- [x] **1.1 Banco na Nuvem (Supabase):**
  - [x] Migrar o banco relacional de preços (SINAPI) e o estado da aplicação do SQLite local para o Supabase (PostgreSQL) ou Turso.
  - [x] Habilitar atualização constante da tabela SINAPI em produção sem necessidade de novos deploys da aplicação.

- [x] **1.2 Persistência e Auto-Save Assíncrono (Zustand + Nuvem):**
  - [x] Manter a memória reativa no cliente via Zustand para performance a 60 FPS.
  - [x] Criar mecanismo de Shadow Save / Auto-Save assíncrono (com Debounce) que grava deltas no banco remoto sem travar a interface do usuário.

- [x] **1.3 Tratamento e Validação no Upload:**
  - [x] Implementar validação e tipagem estrita dos arquivos do Excel recebidos utilizando Zod antes do processamento.
  - [x] Isolar a lógica de processamento massivo do `page.tsx` em Custom Hooks dedicados (ex: `useBudgetProcessor.ts`).

---

## 🚀 SPRINT 2: Escala de Infraestrutura e Fuga dos Timeouts (DevOps & Performance)
*Objetivo: Garantir a estabilidade de processamento para planilhas massivas (5.000+ linhas) e reduzir custos operacionais com IA.*

- [ ] **2.1 Migração do Backend (Cloud Run):**
  - [ ] Empacotar a API FastAPI Python em um container Docker e migrá-la da Vercel para uma plataforma de longa duração (Google Cloud Run), eliminando a barreira de timeout de 10s–60s.

- [ ] **2.2 Filas de Processamento e Streaming em Tempo Real:**
  - [ ] Implementar tarefas em segundo plano para planilhas extensas usando Celery + Redis ou Inngest.
  - [ ] Adicionar Server-Sent Events (SSE) para atualizar a tabela na tela do usuário em tempo real, linha a linha (estilo streaming).

- [ ] **2.3 Cache Semântico Global (Redis):**
  - [ ] Criar camada de cache com Hash MD5 e TTL de 7 a 15 dias para memorizar pesquisas por itens comuns (ex: "Cimento CP II").
  - [ ] Validar a redução de latência para milissegundos e o corte de custos repetitivos de chamadas à OpenAI.

---

## 🧠 SPRINT 3: Motor Híbrido RAG e Precisão de Engenharia (IA Core)
*Objetivo: Assegurar 100% de determinismo e precisão técnica nas recomendações da IA, evitando alucinações e erros de precificação.*

- [ ] **3.1 Algoritmo RRF (Reciprocal Rank Fusion):**
  - [ ] Substituir regras manuais de bônus (+0.5) pelo algoritmo matemático RRF para fundir de forma estável o ranking do Pinecone (Busca Semântica) e do SQLite (Busca Lexical).

- [ ] **3.2 Suporte a Insumos Avulsos (SINAPI-I vs SINAPI-C):**
  - [ ] Manter isolamento estrito: a triagem principal pesquisa apenas em Composições (SINAPI-C).
  - [ ] A base de Insumos (SINAPI-I) só é consultada via Function Calling ou para itens categorizados exclusivamente como material avulso.

- [ ] **3.3 Over-fetching, Filtros Rígidos e JSON Schema:**
  - [ ] Resgatar Top 20 dos bancos, aplicar Reranking e enviar apenas o Top 5 final para a LLM.
  - [ ] Aplicar filtros obrigatórios de Estado (UF) e Desoneração na query antes da busca vetorial.
  - [ ] Substituir parsing via Regex pelo formato Structured Outputs (JSON Schema) da OpenAI.

- [ ] **3.4 Engenharia de Prompt Especializada:**
  - [ ] Injetar lógica de BDI diferenciado (Súmula 2622 do TCU) para fornecimento de materiais e equipamentos específicos.
  - [ ] Aplicar tolerâncias paramétricas (ex: margem rígida para aço, elástica para tubulações).

---

## 🖥️ SPRINT 4: Experiência Avançada do Usuário e Human-in-the-Loop (UX/UI)
*Objetivo: Entregar uma interface interativa de alta performance, permitindo auditoria detalhada, edição rápida e geração de relatórios de nível executivo.*
> [!NOTE]
> A tela da tabela deve continuar extremamente limpa. O Dashboard com Curva ABC e Insights deve ser criado em uma aba ou rota separada, não poluindo a área de trabalho da planilha.

- [ ] **4.1 Virtualização de Tabela e Curva ABC:**
  - [ ] Aplicar virtualização de DOM na `BudgetTable` usando `@tanstack/react-virtual` para renderização fluida de planilhas gigantes.
  - [ ] Exibir painel com Curva ABC dinâmica em uma aba/rota separada.
  - [ ] Tratamento e agrupamento automático de serviços "órfãos" sem etapa definida sob "1.0 - Serviços Preliminares".

- [ ] **4.2 Copiloto Sidebar (Painel de Chat):**
  - [ ] Criar um Copiloto Sidebar para que o usuário possa dar comandos em linguagem natural (ex: 'Altere o insumo X dessa linha').

- [ ] **4.3 Detalhamento Analítico de Composições (Drawer Lateral):**
  - [ ] Revisão de código (Code Review) no modal atual para garantir que o clique está consultando estritamente nosso banco de dados, sem disparar chamadas pagas à OpenAI.

- [ ] **4.4 Edição Reativa e Catálogo do Projeto:**
  - [ ] Implementar modal de edição de composições (`CompositionEditorModal`) rodando recálculos matemáticos 100% no cliente (sem custo de API).
  - [ ] Permitir salvar CPUs validadas na "Biblioteca do Projeto" para rápido reuso em outras linhas da planilha.

- [ ] **4.5 Exportação Profissional em PDF:**
  - [ ] Gerar relatórios executivos em PDF com identidade visual e logotipo da construtora/órgão público.

- [ ] **4.6 Aprendizado Contínuo (RLHF / Memória Organizacional):**
  - [ ] Registrar histórico de edições e substituições do usuário em uma tabela de preferências (`user_preferences`).
  - [ ] Em futuros uploads, a IA consultará as escolhas passadas da empresa, elevando o índice de acerto para clientes recorrentes.

---

## 🔮 SPRINT 5: Inovação, Multimodalidade e Auditoria Documental (Visão de Futuro / P&D)
*Objetivo: Transformar o sistema em um auditor autônomo capaz de cruzar planilhas financeiras com cadernos de encargos e memoriais descritivos.*

- [ ] **5.1 Ingestão Multimodal de PDFs (LlamaParse / Claude 3.5 Sonnet Visão):**
  - [ ] Criar pipeline para leitura, estruturação e vetorização de Memoriais Descritivos e Cadernos de Encargos em PDF num namespace isolado.

- [ ] **5.2 Agente Inspetor de Conformidade:**
  - [ ] Desenvolver agente de IA para cruzar os itens orçamentados no Excel com os requisitos técnicos do PDF, identificando sobrefaturamentos, omissões e downgrades de material.

- [ ] **5.3 Rastreabilidade com Citações Diretas:**
  - [ ] Exigir que qualquer alerta de inconformidade aponte obrigatoriamente a página e o trecho exato do texto original do PDF, mantendo o sistema auditável.
