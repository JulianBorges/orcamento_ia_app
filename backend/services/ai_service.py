import os
import re
import asyncio
import sqlite3
from openai import AsyncOpenAI
from pinecone import Pinecone
from models.schemas import AnaliseItem
from dotenv import load_dotenv

load_dotenv()
async_openai_client = AsyncOpenAI()
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

# O índice só é instanciado se a chave existir para evitar erros de inicialização.
try:
    index = pc.Index("orcamento-engenharia")
except Exception:
    index = None

SYSTEM_PROMPT = """Você é um Engenheiro Sênior Multidisciplinar (Engenharia Civil, Mecânica, Arquitetura e Urbanismo, com foco em Estruturas, Geotecnia, Instalações Hidrossanitárias/Elétricas, PPCI, Climatização, Elevadores e Outros). 
Sua tarefa é mapear descrições de orçamentos legados para a base oficial do SINAPI, utilizando as seguintes Regras Críticas de Aprovação:

REGRA 1: TOLERÂNCIA DE ESCOPO (Macro vs. Micro)
Avalie a ordem de grandeza e a etapa da obra. É ESTRITAMENTE PROIBIDO associar um serviço global/sistêmico (ex: 'Instalação provisória', 'Mobilização', 'Rede de água', 'Canteiro') a uma peça micro/unitária ou conexão (ex: 'um Tê', 'uma bucha', 'um cabo', 'um disjuntor'). Incompatibilidade de escala e esforço exige REJEIÇÃO imediata.

REGRA 2: TOLERÂNCIA FÍSICA E DIMENSIONAL (Limite de 20%)
Se a descrição legada exigir uma dimensão específica (mm, cm, m, kg, etc.), compare com as dimensões das opções do SINAPI. 
Calcule a diferença percentual de forma estrita. Se a variação da grandeza for SUPERIOR a 20%, REJEITE a opção por incompatibilidade física. 
Se a variação for de até 20%, a opção é aceitável como premissa, mas você DEVE exibir o cálculo percentual na sua justificativa.

REGRA 3: ESCOPO GENÉRICO VS ESPECÍFICO (Regra da Aplicação Padrão)
Se a descrição legada for genérica (ex: "Tubo PVC 25mm", "Regularização de subleito") e as opções do SINAPI exigirem uma especificidade (ex: uso em ramal de água, dreno, solo argiloso, arenoso), você DEVE selecionar a opção de uso MAIS COMUM e padrão na engenharia civil (ex: água fria/ramal para tubos convencionais, solo misto/predominante para terraplenagem). 
NUNCA selecione usos de nicho (ex: dreno de ar-condicionado) se o legado for genérico.

REGRA 4: ESTRUTURA E CLASSIFICAÇÃO DA RESPOSTA (OBRIGATÓRIO JSON)
- Se houver correspondência exata ou equivalência plena: status = "ACEITO" e justifique.
- Se houver diferença aceitável (tolerância de 20%) ou se você assumiu o uso mais comum para um legado genérico (Regra 3): status = "ACEITO COM PREMISSA" e justifique a escolha do uso padrão.
- Se quebrar as regras de Escopo Macro vs Micro (Regra 1) ou de Dimensão física >20% (Regra 2): status = "REJEITADO" e explique a violação.
Sua resposta final deve ser estritamente no formato JSON estruturado solicitado.
"""

def lexical_reranker(query: str, semantic_matches: list) -> list:
    """
    Reranker Lexical: Sobrepõe uma pontuação de match exato por cima do score semântico.
    Resolve 'A Maldição da Busca Semântica com Números' normalizando as unidades (ex: 50 mm -> 50mm).
    """
    if not semantic_matches:
        return []
        
    # 1. Normalização da Query
    # Remove espaços antes de unidades comuns de engenharia para padronizar
    # Exemplo: "50 mm" vira "50mm", "200 KG" vira "200kg"
    norm_query = query.lower()
    norm_query = re.sub(r'(\d+)\s*(mm|cm|m|kg|m2|m3|l|w|v)', r'\1\2', norm_query)
    
    # Extrai tokens (palavras) com 2+ caracteres ou números
    query_tokens = set(re.findall(r'\b\w+\b', norm_query))
    if not query_tokens:
        return semantic_matches

    reranked = []
    for match in semantic_matches:
        # Pega a descrição do banco e normaliza com a mesma regra
        desc = match.get('metadata', {}).get('descricao', '').lower()
        norm_desc = re.sub(r'(\d+)\s*(mm|cm|m|kg|m2|m3|l|w|v)', r'\1\2', desc)
        desc_tokens = set(re.findall(r'\b\w+\b', norm_desc))
        
        lexical_score = 0.0
        
        for token in query_tokens:
            if token in desc_tokens:
                # Recompensa gigante se for um número ou dimensão (ex: '50', '50mm', '3/4')
                if any(char.isdigit() for char in token):
                    lexical_score += 5.0
                else:
                    lexical_score += 1.0
                    
        # Score Híbrido: Combina o Match Lexical com o Score Semântico original do Pinecone
        hybrid_score = match['score'] + (lexical_score * 0.1)
        
        reranked.append({
            **match,
            'hybrid_score': hybrid_score
        })
        
    # Ordena pelo novo Score Híbrido decrescente
    reranked.sort(key=lambda x: x['hybrid_score'], reverse=True)
    
    # Atualiza visualmente o Score para refletir a nova confiança
    for r in reranked:
        r['score'] = min(r['hybrid_score'], 1.0) # Cap em 100% no visual
        del r['hybrid_score']
        
    return reranked

async def buscar_semelhantes_pinecone_async(descricao: str, top_k: int = 15):
    """Busca assíncrona no Pinecone (via embeddings da OpenAI) com Reranker Lexical."""
    res = await async_openai_client.embeddings.create(model="text-embedding-3-small", input=descricao)
    vector = res.data[0].embedding
    
    # Busca Ampla Semântica: Traz 100 itens em vez de 15, para não perder nenhum cano.
    loop = asyncio.get_event_loop()
    query_response = await loop.run_in_executor(
        None, 
        lambda: index.query(vector=vector, top_k=100, include_metadata=True, namespace="composicoes_sinapi")
    )
    
    # Converte o ScoredVector do Pinecone para dict nativo do Python para não dar erro de TypeError no unpacking (**)
    semantic_matches = [{'id': m['id'], 'score': m['score'], 'metadata': m.get('metadata', {})} for m in query_response['matches']]
    
    # Retorna todos (sem cortar) para que o motor Híbrido Final faça o rerank se necessário.
    # Nota: se for chamado diretamente, ele retorna os 100 itens.
    return semantic_matches

def buscar_sqlite_sync(query: str, top_k: int = 15):
    """Busca ultra-rápida no SQLite FTS5 (Lexical puro)."""
    # Remove pontuações e cria a query FTS
    query_limpa = re.sub(r'[^\w\s]', ' ', query)
    tokens = [t for t in query_limpa.split() if len(t) > 1 or t.isdigit()]
    if not tokens:
        return []
    
    fts_query = " ".join([f"{t}*" for t in tokens])
    
    conn = sqlite3.connect("sinapi.db")
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT codigo, descricao, preco, unidade 
            FROM composicoes 
            WHERE composicoes MATCH ? 
            ORDER BY rank 
            LIMIT ?
        ''', (fts_query, top_k))
        
        resultados = []
        for row in cursor.fetchall():
            resultados.append({
                'id': row[0],
                'score': 1.0, # Match exato
                'metadata': {
                    'codigo': row[0],
                    'descricao': row[1],
                    'preco': row[2],
                    'unidade': row[3]
                }
            })
        return resultados
    except Exception as e:
        print("Erro SQLite FTS:", e)
        return []
    finally:
        conn.close()

async def buscar_sqlite_async(query: str, top_k: int = 15):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: buscar_sqlite_sync(query, top_k))

async def buscar_verdadeiro_hibrido_async(descricao: str, top_k: int = 15):
    """Busca no Pinecone (Semântico) + SQLite (Lexical) e passa pelo Reranker."""
    # Dispara as duas buscas em paralelo
    task_pinecone = buscar_semelhantes_pinecone_async(descricao, top_k=50) # Traz 100 por baixo dos panos
    task_sqlite = buscar_sqlite_async(descricao, top_k=20)
    
    res_pinecone, res_sqlite = await asyncio.gather(task_pinecone, task_sqlite)
    
    # Junta resultados removendo duplicadas
    vistos = set()
    matches_combinados = []
    
    # Prioriza o SQLite pois são Matches Exatos
    for m in res_sqlite:
        if m['id'] not in vistos:
            vistos.add(m['id'])
            matches_combinados.append(m)
            
    for m in res_pinecone:
        if m['id'] not in vistos:
            vistos.add(m['id'])
            matches_combinados.append(m)
            
    # Aplica o Reranker para dar a nota final misturando Semântica e Lexical
    hybrid_matches = lexical_reranker(descricao, matches_combinados)
    
    return hybrid_matches[:top_k]

SYSTEM_PROMPT_REVISOR_MAPEAMENTO = """Você é um Auditor Sênior de Engenharia (Agente Revisor).
Sua missão é atuar como controle de qualidade rigoroso sobre as decisões do Agente Estimador no mapeamento de itens do SINAPI.
O Estimador já avaliou a descrição legada e propôs um mapeamento. Sua tarefa é auditar essa decisão com base nas Regras:
1. Escopo (Macro vs Micro): O Estimador cometeu o erro de associar um sistema global a uma peça unitária, ou vice-versa? 
   ATENÇÃO/EXCEÇÃO: É ESTRITAMENTE PROIBIDO rejeitar por erro de escopo se o item SINAPI apenas possuir uma especificação a mais que o legado (ex: o SINAPI cita aplicação em ramal, dreno, ou tipo de solo argiloso, enquanto o legado é um genérico "Tubo PVC" ou "Regularização de subleito"). Nesses casos, o Estimador está correto em assumir o uso mais comum. Só rejeite se a função técnica for grotescamente incompatível (ex: Tubo de esgoto para cabos elétricos, ou saibro vs macadame britado).
2. Matemática Dimensional: O Estimador aceitou uma variação dimensional (em mm, cm, kg) SUPERIOR a 20%? Se sim, isso é uma falha grave.
3. Compatibilidade Funcional: A solução do Estimador atende tecnicamente a função solicitada?

Se a decisão do Estimador for aceitável e respeitar as regras e exceções, MANTENHA O STATUS, o ID e apenas melhore a justificativa se necessário.
Se o Estimador violou regras de Macro vs Micro ou os limites matemáticos de 20%, CORRIJA O STATUS OBRIGATORIAMENTE para "REJEITADO", mantenha o ID como null/nenhum, e aponte a falha grave na sua justificativa final.
A sua resposta final deve ser estritamente o JSON estruturado solicitado.
"""

def agente_pesquisador_dossie(opcoes_pinecone: list) -> str:
    """Agente Pesquisador: Estruturador Determinístico de Metadados Ricos."""
    linhas = []
    for m in opcoes_pinecone:
        id_limpo = str(m['id']).replace('comp_', '')
        meta = m.get('metadata', {})
        desc = meta.get('descricao', 'N/A')
        und = meta.get('unidade', 'N/A')
        
        # Converte preco de forma segura
        try:
            preco = float(meta.get('preco', 0.0))
        except (ValueError, TypeError):
            preco = 0.0
            
        dossie = f"ID: {id_limpo} | Und: {und} | Custo Base: R$ {preco:.2f} | Descrição: {desc}"
        linhas.append(dossie)
    
    return "\n".join(linhas)

async def fluxo_multi_agentes_mapeamento_async(descricao_legada: str, opcoes_pinecone: list) -> AnaliseItem:
    """Orquestrador do Pipeline de Multi-Agentes para Mapeamento."""
    # 1. Agente Pesquisador (Constrói o Raio-X do SINAPI)
    dossie_texto = agente_pesquisador_dossie(opcoes_pinecone)
    
    # 2. Agente Estimador (Gera a primeira decisão)
    completion_est = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Descrição Original do Projeto:\n{descricao_legada}\n\nDossiê das Opções SINAPI:\n{dossie_texto}\n\nFaça o mapeamento obedecendo estritamente às Regras de 20% e Escopo."}
        ],
        response_format=AnaliseItem,
        max_tokens=800,
    )
    analise_estimador = completion_est.choices[0].message.parsed
    
    # Com o novo Motor Híbrido filtrando cirurgicamente as 5 melhores opções,
    # o Agente Revisor se tornou redundante. O Estimador tem precisão suficiente.
    return analise_estimador

# ========================================================
# MOTOR MULTI-AGENTES DE ENGENHARIA (FASE 2 - PLANO V2)
# ========================================================

async def agente_pesquisador_composicoes(descricao: str, top_k: int = 5):
    """Agente 1: Busca no Pinecone por Composições SINAPI similares para usar como referência."""
    res = await async_openai_client.embeddings.create(model="text-embedding-3-small", input=descricao)
    vector = res.data[0].embedding
    
    index_v2 = pc.Index("orcamento-engenharia")
    loop = asyncio.get_event_loop()
    query_response = await loop.run_in_executor(
        None, 
        lambda: index_v2.query(vector=vector, top_k=top_k, include_metadata=True, namespace="composicoes_sinapi")
    )
    return query_response['matches']

SYSTEM_PROMPT_ENGENHEIRO = """Você é um Engenheiro de Custos (Agente Criador).
Missão: Criar uma Composição de Preço Unitário (CPU) INÉDITA baseando-se em composições de referência reais do SINAPI.
REGRAS:
1. Estude as referências do SINAPI fornecidas para entender os coeficientes normais de mão de obra (ex: horas de pedreiro por m2).
2. Se o serviço pedido tiver um material diferente, troque-o, mas mantenha a coerência da produtividade.
3. Não invente coeficientes do nada; extrapole e interpole das referências.
4. Gere a tabela. Não se preocupe com erros de arredondamento, o Agente Revisor irá conferir."""

SYSTEM_PROMPT_REVISOR = """Você é um Auditor de Custos Sênior (Agente Revisor).
Missão: Revisar o JSON de uma CPU gerada por um Engenheiro Júnior.
REGRAS:
1. Matemática perfeita: Para cada item, `valor_total` DEVE SER EXATAMENTE `coeficiente * valor_unitario`. Corrija se necessário.
2. Soma total: `valor_total_composicao` DEVE SER EXATAMENTE o somatório dos `valor_total` de todos os itens.
3. Responda APENAS o JSON validado, preenchendo a `justificativa` com a explicação das suas auditorias."""

async def gerar_composicao_agentes_async(servico: str) -> dict:
    from models.schemas import ComposicaoGerada
    
    # 1. Agente Pesquisador (Recupera Conhecimento)
    referencias = await agente_pesquisador_composicoes(servico)
    refs_texto = "\n\n".join([f"REF {i+1}: {m['metadata'].get('descricao')}\nJSON Base: {m['metadata'].get('json_composicao')}" for i, m in enumerate(referencias)])
    
    # 2. Agente Engenheiro (Rascunha a CPU)
    completion_eng = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT_ENGENHEIRO},
            {"role": "user", "content": f"SERVIÇO SOLICITADO: {servico}\n\nREFERÊNCIAS SINAPI ENCONTRADAS:\n{refs_texto}"}
        ],
        response_format=ComposicaoGerada,
    )
    cpu_bruta = completion_eng.choices[0].message.parsed
    
    # 3. Agente Revisor (Valida Matemática e Consistência)
    completion_rev = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT_REVISOR},
            {"role": "user", "content": f"Audite e corrija matematicamente esta CPU bruta:\n{cpu_bruta.model_dump_json()}"}
        ],
        response_format=ComposicaoGerada,
    )
    return completion_rev.choices[0].message.parsed.model_dump()
