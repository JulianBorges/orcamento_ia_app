# OrceIA - Guia de Contexto para Inteligência Artificial (System Prompt)

> **Instrução para a IA:** Se você está lendo este arquivo no início de um chat, use-o como base absoluta de contexto arquitetural antes de propor qualquer código ou refatoração.

## 1. Visão Geral do Projeto
O **OrceIA** é um Copiloto de Orçamento de Engenharia de alta performance. Ele recebe planilhas massivas (5.000+ linhas) do usuário, normaliza os dados, cruza com bancos oficiais (SINAPI) via Busca Semântica Híbrida e devolve o orçamento preenchido em tempo real.

## 2. Stack Tecnológica
- **Frontend:** Next.js (React), Tailwind CSS, Zustand (Gerenciamento de Estado Reativo).
- **Backend:** FastAPI (Python, 100% Assíncrono com `asyncio`).
- **Banco de Dados (Relacional):** Supabase (PostgreSQL) para persistência de orçamentos.
- **Banco de Dados (Vetorial):** Pinecone (Busca semântica e armazenamento em cache O(1)).
- **Mensageria / Tempo Real:** Redis Streams (`XADD`/`XREAD`) servindo dados via Server-Sent Events (SSE).
- **IA:** OpenAI API (Embeddings + Structured Outputs).

## 3. Pilares Arquiteturais Críticos (NÃO QUEBRE)

### 3.1. Performance do Frontend (60 FPS)
A tabela principal (`BudgetTable.tsx`) renderiza milhares de linhas. Para isso, ela utiliza:
- **DOM Virtualization** (`@tanstack/react-virtual`): Apenas os itens na tela (viewport) existem no DOM. Alterações de CSS devem respeitar `transform: translateY` e `position: absolute`.
- **Drag-n-Drop** (`@dnd-kit`): Integrado diretamente com a virtualização.
- **Debounced Auto-Save:** O hook `useAutoSave.ts` faz *Deep Compare* via serialização JSON e um debounce estrito nativo de 3000ms antes de disparar o `upsert` no Supabase. O UI state (como expandir menus) não engatilha salvamentos.

### 3.2. Infraestrutura Backend e SSE Resiliente
O ambiente de hospedagem (Vercel / Cloud Run) impõe timeouts rigorosos (ex: 60 segundos). O backend burla essa limitação através de uma arquitetura tolerante a falhas:
- **Processamento em Chunks:** Lotes do Excel são processados de 50 em 50 para evitar thundering herd.
- **Redis Streams (XADD):** Os resultados da IA são gravados na memória do Redis com um TTL de 1 hora.
- **Recuperação de SSE (XREAD):** O endpoint SSE (`routes.py`) lê o cabeçalho `Last-Event-ID`. Se a nuvem cortar a conexão, o navegador reconecta passando o último ID e o backend despeja os pacotes perdidos instantaneamente.
- **Fallback in-memory:** O `cache_service.py` possui emulação de streams nativa via dicionários locais para permitir o desenvolvimento quando o Redis não estiver rodando na máquina do dev.

### 3.3. Motor de Busca (Algoritmo RRF)
A IA não "chuta" preços. O processo no `ai_service.py` funciona assim:
1. **RRF (Reciprocal Rank Fusion):** O backend realiza uma busca lexical (SQLite/Memória) e uma vetorial (Pinecone). As posições são fundidas matematicamente para criar um Ranking final perfeito.
2. O Top 5 vai para o LLM da OpenAI, que elege a melhor opção usando `Structured Outputs` (JSON Schema rigoroso).
3. **Custo Zero em Detalhes:** A abertura de modais para visualizar a "Memória de Cálculo" ou detalhes de composição NUNCA chama a OpenAI. As requisições batem direto no ID do Pinecone (`index_v2.fetch`).

## 4. Como Navegar no Código
- O plano de voo e as prioridades oficiais de desenvolvimento sempre estarão no arquivo raiz **`Master_Plan.md`**.
- Sempre confira o `Master_Plan.md` antes de propor criação de novas features.

## 5. Regras de Código (Guidelines)
- **KISS (Keep It Simple, Stupid):** Prefira funções nativas do React/Python antes de instalar novas dependências (ex: usamos `setTimeout` em vez de `use-debounce`).
- **No Hallucinations:** Nunca invente funções do Pinecone ou do Redis que não existam nas versões modernas assíncronas instaladas no `requirements.txt`.
- **Tratamento Cauteloso de Exceções:** Tasks assíncronas do backend (como `gather`) devem usar `return_exceptions=True` para não quebrarem o Event Loop e interromperem o fluxo de SSE do usuário caso a API da OpenAI caia.
- **Função acima da Forma (Anti-Gambiarras Visuais):** Jamais sacrifique a performance da aplicação (60 FPS) para adicionar efeitos visuais desnecessários (animações de entrada lentas, efeitos dominó ou renderizações em cascata). A UI deve ser utilitária, instantânea e suportar 5.000+ itens sem engasgos.
- **Matemática Offline:** Todo e qualquer recálculo de preço, BDI ou quantidades dentro de uma composição (Modal de Edição) deve rodar 100% no cliente via Zustand. Não crie endpoints no backend para somar ou multiplicar valores de interface.
- **Atue como Tech Lead Sênior:** Ao analisar um problema, não me entregue apenas o código. Explique brevemente o gargalo arquitetural, os riscos da sua abordagem e garanta que a solução proposta escala para ambientes governamentais massivos.