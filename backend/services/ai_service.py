import os
import re
import asyncio
import sqlite3
from openai import AsyncOpenAI
from pinecone import Pinecone
from models.schemas import AnaliseItem
from dotenv import load_dotenv
from pathlib import Path
from cachetools import TTLCache

load_dotenv()
async_openai_client = AsyncOpenAI()
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

# Conexão Global Read-Only para otimizar Lotes na Vercel
GLOBAL_SQLITE_CONN = None

# Cache Semântico em Memória: Armazena até 1000 buscas recentes por 1 hora
semantic_cache = TTLCache(maxsize=1000, ttl=3600)

def get_sqlite_conn():
    global GLOBAL_SQLITE_CONN
    if GLOBAL_SQLITE_CONN is None:
        db_path = Path(__file__).parent.parent / "sinapi.db"
        try:
            # check_same_thread=False é seguro apenas para leitura
            GLOBAL_SQLITE_CONN = sqlite3.connect(str(db_path), check_same_thread=False)
        except Exception:
            return sqlite3.connect(str(db_path))
    return GLOBAL_SQLITE_CONN

# O índice deve existir. Falhamos rápido (Fail-Fast) se houver erro para não mascarar problemas.
try:
    index = pc.Index("orcamento-engenharia")
except Exception as e:
    raise RuntimeError(f"Erro Crítico: Falha ao conectar no Pinecone. Detalhes: {str(e)}")

def load_prompt(filename):
    prompt_path = Path(__file__).parent.parent / "prompts" / filename
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()

SYSTEM_PROMPT = load_prompt("mapeamento.md")

def lexical_reranker(query: str, semantic_matches: list) -> list:
    """
    Reranker Lexical: Sobrepõe uma pontuação de match exato por cima do score semântico.
    Resolve 'A Maldição da Busca Semântica com Números' normalizando as unidades (ex: 50 mm -> 50mm).
    """
    if not semantic_matches:
        return []
        
    # 1. Normalização da Query
    # Remove espaços antes de unidades para padronizar.
    # Agora suporta decimais e frações. Exemplo: "50 mm" -> "50mm", "1,5 m" -> "1,5m", "3/4 pol" -> "3/4pol"
    norm_query = query.lower()
    norm_query = re.sub(r'(\d+(?:[.,/]\d+)?)\s*(mm|cm|m|kg|m2|m3|l|w|v|in|pol|")', r'\1\2', norm_query)
    
    # Extrai tokens (palavras) removendo apenas pontuações soltas nas pontas para manter decimais inteiros
    raw_tokens = norm_query.split()
    query_tokens = set(t.strip('.,;:()[]{}!') for t in raw_tokens if t.strip('.,;:()[]{}!'))
    if not query_tokens:
        return semantic_matches

    reranked = []
    for match in semantic_matches:
        # Pega a descrição do banco e normaliza com a mesma regra
        desc = match.get('metadata', {}).get('descricao', '').lower()
        norm_desc = re.sub(r'(\d+(?:[.,/]\d+)?)\s*(mm|cm|m|kg|m2|m3|l|w|v|in|pol|")', r'\1\2', desc)
        
        desc_raw_tokens = norm_desc.split()
        desc_tokens = set(t.strip('.,;:()[]{}!') for t in desc_raw_tokens if t.strip('.,;:()[]{}!'))
        
        lexical_score = 0.0
        
        for token in query_tokens:
            if token in desc_tokens:
                # Recompensa gigante se for um número ou dimensão (ex: '50', '50mm', '1,5m', '3/4')
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

async def buscar_semelhantes_pinecone_async(descricao: str, top_k: int = 15, vector: list = None):
    """Busca assíncrona no Pinecone (via embeddings da OpenAI) com Reranker Lexical."""
    if vector is None:
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
    
    conn = get_sqlite_conn()
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

async def buscar_sqlite_async(query: str, top_k: int = 15):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: buscar_sqlite_sync(query, top_k))

async def buscar_verdadeiro_hibrido_async(descricao: str, top_k: int = 15, vector: list = None):
    """Busca no Pinecone (Semântico) + SQLite (Lexical) e passa pelo Reranker."""
    
    # Verifica cache (apenas se vector for None, que é o caso comum sem batching)
    cache_key = f"hibrido_{descricao}_{top_k}"
    if vector is None and cache_key in semantic_cache:
        return semantic_cache[cache_key]
        
    # Dispara as duas buscas em paralelo
    task_pinecone = buscar_semelhantes_pinecone_async(descricao, top_k=50, vector=vector) # Traz 100 por baixo dos panos
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
    
    final_result = hybrid_matches[:top_k]
    
    if vector is None:
        semantic_cache[cache_key] = final_result
        
    return final_result



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

async def fluxo_multi_agentes_mapeamento_async(item_legado, opcoes_pinecone: list) -> AnaliseItem:
    """Orquestrador do Pipeline de Multi-Agentes para Mapeamento."""
    # 1. Agente Pesquisador (Constrói o Raio-X do SINAPI)
    dossie_texto = agente_pesquisador_dossie(opcoes_pinecone)
    
    # Prepara os dados do legado ricos em contexto
    contexto_legado = f"Descrição: {item_legado.descricao}\nUnidade Original: {item_legado.unidade}\nValor Unitário Original: R$ {item_legado.valorUnit}\nQuantidade: {item_legado.quantidade}"
    
    # 2. Agente Estimador (Gera a primeira decisão)
    completion_est = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"DADOS DO ORÇAMENTO LEGADO:\n{contexto_legado}\n\nDOSSIÊ DAS OPÇÕES SINAPI:\n{dossie_texto}\n\nFaça o mapeamento obedecendo estritamente às Regras de 20%, Escopo e Unidade."}
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
    cache_key = f"comps_{descricao}_{top_k}"
    if cache_key in semantic_cache:
        return semantic_cache[cache_key]
        
    res = await async_openai_client.embeddings.create(model="text-embedding-3-small", input=descricao)
    vector = res.data[0].embedding
    
    index_v2 = pc.Index("orcamento-engenharia")
    loop = asyncio.get_event_loop()
    query_response = await loop.run_in_executor(
        None, 
        lambda: index_v2.query(vector=vector, top_k=top_k, include_metadata=True, namespace="composicoes_sinapi")
    )
    
    semantic_cache[cache_key] = query_response['matches']
    return query_response['matches']

SYSTEM_PROMPT_ENGENHEIRO = load_prompt("engenheiro.md")
SYSTEM_PROMPT_REVISOR = load_prompt("revisor.md")

async def gerar_composicao_agentes_async(servico: str) -> dict:
    from models.schemas import ComposicaoGerada
    
    # 1. Agente Pesquisador (Recupera Conhecimento)
    referencias = await agente_pesquisador_composicoes(servico)
    refs_texto = "\n\n".join([f"REF {i+1}: {m['metadata'].get('descricao')}\nJSON Base: {m['metadata'].get('json_composicao')}" for i, m in enumerate(referencias)])
    
    # 2. Agente Engenheiro (Rascunha a CPU)
    completion_eng = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT_ENGENHEIRO},
            {"role": "user", "content": f"SERVIÇO SOLICITADO: {servico}\n\nREFERÊNCIAS SINAPI ENCONTRADAS:\n{refs_texto}"}
        ],
        response_format=ComposicaoGerada,
    )
    cpu_bruta = completion_eng.choices[0].message.parsed
    
    # 3. Agente Revisor (Valida Matemática e Consistência)
    completion_rev = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT_REVISOR},
            {"role": "user", "content": f"Audite e corrija matematicamente esta CPU bruta:\n{cpu_bruta.model_dump_json()}"}
        ],
        response_format=ComposicaoGerada,
    )
    return completion_rev.choices[0].message.parsed.model_dump()
