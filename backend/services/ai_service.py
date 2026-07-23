import os
import re
import asyncio
import sqlite3
from openai import AsyncOpenAI
from pinecone import Pinecone
from models.schemas import (
    StatelessBatchItem, AnaliseItem, ComposicaoRequest, 
    ComposicaoGerada, ComposicaoItem, EAPGenerationRequest, EAPResponse,
    LoteCorrigido
)
from dotenv import load_dotenv
from pathlib import Path
from cachetools import TTLCache

load_dotenv()
async_openai_client = AsyncOpenAI()
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

# Cache Semântico em Memória: Armazena até 1000 buscas recentes por 1 hora
semantic_cache = TTLCache(maxsize=1000, ttl=3600)

def get_sqlite_conn():
    db_path = Path(__file__).parent.parent / "sinapi.db"
    return sqlite3.connect(str(db_path))

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
SYSTEM_PROMPT_CORRETOR = load_prompt("corretor.md")

async def corrigir_descricoes_lote_async(itens: list[dict]) -> dict:
    """
    Função em lote para o LLM Normalizador.
    Espera uma lista de dicionários {"id": "1", "descricao_original": "..."}
    Retorna um dicionário {id: descricao_corrigida}
    """
    if not itens:
        return {}
        
    try:
        response = await async_openai_client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT_CORRETOR},
                {"role": "user", "content": str(itens)}
            ],
            response_format=LoteCorrigido,
            temperature=0.1
        )
        lote_corrigido = response.choices[0].message.parsed
        return {item.id: item.descricao_corrigida for item in lote_corrigido.itens}
    except Exception as e:
        print(f"Erro na normalização em lote: {e}")
        return {}

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
    
    STOP_WORDS = {'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos', 'por', 'para', 'com', 'sem', 'a', 'o', 'as', 'os', 'e', 'ou', 'um', 'uma', 'uns', 'umas'}
    
    # Extrai tokens (palavras) removendo pontuações soltas e stop words
    raw_tokens = norm_query.split()
    query_tokens = set(t.strip('.,;:()[]{}!') for t in raw_tokens if t.strip('.,;:()[]{}!') and t.strip('.,;:()[]{}!') not in STOP_WORDS)
    if not query_tokens:
        return semantic_matches

    reranked = []
    for match in semantic_matches:
        # Pega a descrição do banco e normaliza com a mesma regra
        desc = match.get('metadata', {}).get('descricao', '').lower()
        norm_desc = re.sub(r'(\d+(?:[.,/]\d+)?)\s*(mm|cm|m|kg|m2|m3|l|w|v|in|pol|")', r'\1\2', desc)
        
        desc_raw_tokens = norm_desc.split()
        desc_tokens = set(t.strip('.,;:()[]{}!') for t in desc_raw_tokens if t.strip('.,;:()[]{}!') and t.strip('.,;:()[]{}!') not in STOP_WORDS)
        
        matches_word = 0
        matches_number = 0
        
        for token in query_tokens:
            if token in desc_tokens:
                if any(char.isdigit() for char in token):
                    matches_number += 1
                else:
                    matches_word += 1
                    
        # Proporção de acerto das palavras textuais (máximo +0.15)
        text_tokens_count = len([t for t in query_tokens if not any(c.isdigit() for c in t)])
        word_ratio = matches_word / text_tokens_count if text_tokens_count > 0 else 0
        
        # Bônus para números exatos, crucial na engenharia (máximo +0.30)
        number_bonus = min(0.30, matches_number * 0.10)
        
        # Score Híbrido Proporcional
        hybrid_score = match['score'] + (word_ratio * 0.15) + number_bonus
        
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
        lambda: index.query(
            vector=vector, 
            top_k=100, 
            include_metadata=True, 
            namespace="composicoes_sinapi",
            filter={"tipo": "composicao"}
        )
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
    try:
        cursor = conn.cursor()
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
            
        dossie = f"Código: {id_limpo} | Und: {und} | Custo Base: R$ {preco:.2f} | Descrição: {desc}"
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
        lambda: index_v2.query(
            vector=vector, 
            top_k=top_k, 
            include_metadata=True, 
            namespace="composicoes_sinapi",
            filter={"tipo": "composicao"}
        )
    )
    
    semantic_cache[cache_key] = query_response['matches']
    return query_response['matches']

async def agente_pesquisador_insumos(descricao: str, top_k: int = 15):
    """Busca no Pinecone por Insumos SINAPI relevantes ao serviço."""
    cache_key = f"insumos_{descricao}_{top_k}"
    if cache_key in semantic_cache:
        return semantic_cache[cache_key]
        
    res = await async_openai_client.embeddings.create(model="text-embedding-3-small", input=descricao)
    vector = res.data[0].embedding
    
    index_v2 = pc.Index("orcamento-engenharia")
    loop = asyncio.get_event_loop()
    query_response = await loop.run_in_executor(
        None, 
        lambda: index_v2.query(
            vector=vector, 
            top_k=top_k, 
            include_metadata=True, 
            namespace="composicoes_sinapi",
            filter={"tipo": "insumo"}
        )
    )
    
    semantic_cache[cache_key] = query_response['matches']
    return query_response['matches']

SYSTEM_PROMPT_ENGENHEIRO = load_prompt("engenheiro.md")
SYSTEM_PROMPT_REVISOR = load_prompt("revisor.md")

async def gerar_composicao_agentes_async(servico: str) -> dict:
    from models.schemas import ComposicaoGerada
    
    # 1. Agente Pesquisador (Recupera Conhecimento)
    # Busca Composições e Insumos em paralelo para ganho de performance
    referencias, insumos_catalogo = await asyncio.gather(
        agente_pesquisador_composicoes(servico, top_k=5),
        agente_pesquisador_insumos(servico, top_k=15)
    )
    
    refs_texto = "=== COMPOSIÇÕES DE REFERÊNCIA SINAPI ===\n" + "\n\n".join([f"REF {i+1}: {m['metadata'].get('descricao')}\nJSON Base: {m['metadata'].get('json_composicao')}" for i, m in enumerate(referencias)])
    
    insumos_texto = "\n\n=== CATÁLOGO DE INSUMOS SINAPI DISPONÍVEIS ===\n" + "\n".join([
        f"- Cód: {m['metadata'].get('codigo')} | {m['metadata'].get('descricao')} | Un: {m['metadata'].get('unidade')} | Preço: R$ {m['metadata'].get('custo'):.2f}"
        for m in insumos_catalogo
    ])
    
    contexto_completo = f"{refs_texto}\n{insumos_texto}"
    
    # 2. Agente Engenheiro (Rascunha a CPU)
    completion_eng = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT_ENGENHEIRO},
            {"role": "user", "content": f"SERVIÇO SOLICITADO: {servico}\n\n{contexto_completo}"}
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
    cpu = completion_rev.choices[0].message.parsed
    
    # Garantia estrita: o valor unitário deve vir do banco SINAPI, não do LLM.
    catalogo_map = {str(m['metadata'].get('codigo')): m['metadata'] for m in insumos_catalogo}
    total_comp = 0.0
    
    for item in cpu.itens:
        meta = catalogo_map.get(str(item.codigo_sinapi))
        if meta:
            item.descricao = meta.get('descricao', item.descricao)
            item.unidade = meta.get('unidade', item.unidade)
            item.valor_unitario = float(meta.get('custo', item.valor_unitario))
        
        item.valor_total = round(item.coeficiente * item.valor_unitario, 2)
        total_comp += item.valor_total
        
    cpu.valor_total_composicao = round(total_comp, 2)
    return cpu.model_dump()

async def gerar_eap_inteligente_async(request: EAPGenerationRequest) -> dict:
    prompt = """Você é um engenheiro orçamentista sênior. 
Recebeu uma lista plana (desestruturada) de serviços de obra. 
Seu objetivo é analisar esses serviços e agrupá-los em macro-etapas lógicas de engenharia (ex: 1.0 INFRAESTRUTURA, 2.0 SUPERESTRUTURA, etc).
Devolva um objeto estruturado contendo a lista de etapas, onde cada etapa tem um nome lógico e a lista exata dos IDs dos serviços que pertencem a ela.
Atenção: 
1. Você NÃO PODE omitir IDs. TODOS os IDs fornecidos devem ser alocados.
2. Você NÃO PODE inventar IDs. Use apenas os IDs fornecidos.
3. Agrupe de forma que a sequência cronológica da obra faça sentido."""

    itens_json = [{"id": item.id, "descricao": item.descricao} for item in request.itens]
    
    completion = await async_openai_client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"Serviços:\n{itens_json}"}
        ],
        response_format=EAPResponse,
        temperature=0.0
    )
    
    return completion.choices[0].message.parsed.model_dump()

async def buscar_composicao_por_codigo_async(codigo: str) -> dict:
    """Busca os detalhes de uma composição específica no Pinecone pelo código (SINAPI)."""
    index_v2 = pc.Index("orcamento-engenharia")
    loop = asyncio.get_event_loop()
    
    # O ID no Pinecone é prefixado com comp_ para composições SINAPI
    pinecone_id = f"comp_{codigo}"
    
    try:
        response = await loop.run_in_executor(
            None,
            lambda: index_v2.fetch(ids=[pinecone_id], namespace="composicoes_sinapi")
        )
        
        matches = response.get('vectors', {})
        if pinecone_id in matches:
            vector_data = matches[pinecone_id]
            metadata = vector_data.get('metadata', {})
            json_comp = metadata.get('json_composicao', '[]')
            import json
            try:
                itens = json.loads(json_comp)
            except:
                itens = []
                
            return {
                "codigo": metadata.get("codigo", codigo),
                "descricao": metadata.get("descricao", ""),
                "unidade": metadata.get("unidade", ""),
                "valor_total_composicao": metadata.get("custo", 0.0),
                "itens": itens
            }
        return None
    except Exception as e:
        print(f"Erro ao buscar composição {codigo}: {e}")
        return None
