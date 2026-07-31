import asyncio
import pandas as pd
import numpy as np
import io
import uuid
from typing import Dict, Any
from services.ai_service import buscar_verdadeiro_hibrido_async, fluxo_multi_agentes_mapeamento_async

from models.schemas import StatelessBatchItem
from services.cache_service import publish_sse_event

# Semáforo global para concorrência da OpenAI
# Reduzido para 10 para não estourar o limite de 200k TPM (Tokens Per Minute) da OpenAI
openai_semaphore = asyncio.Semaphore(10)

async def process_item_with_semaphore(item: StatelessBatchItem, ai_function, *args):
    """Executa uma função de IA respeitando o limite do semáforo com retentativas e backoff."""
    max_retries = 5
    async with openai_semaphore:
        for attempt in range(max_retries):
            try:
                # Pequeno delay inicial espalhado para evitar thundering herd no primeiro segundo
                if attempt == 0:
                    await asyncio.sleep(np.random.uniform(0.1, 1.5))
                    
                resultado = await ai_function(item, *args)
                
                # Se a função interna retornou ERRO por Rate Limit ou Timeout, lançamos a exceção para ativar o Retry
                if isinstance(resultado, dict) and resultado.get("status") == "ERRO":
                    erro_str = resultado.get("erro", "").lower()
                    if any(term in erro_str for term in ["429", "rate limit", "502", "503", "timeout", "timed out", "connection"]):
                        raise Exception(f"RateLimit/Timeout: {erro_str}")
                    else:
                        # Erros técnicos/banco (não-rede) não adiantam tentar de novo
                        return {"id": item.id, "status": "ERRO", "erro": resultado.get("erro")}
                
                return {"id": item.id, "status": "SUCESSO", "resultado": resultado}
            
            except Exception as e:
                erro_str = str(e).lower()
                # Considera Rate Limits, Timeouts e problemas de conexão da OpenAI como passíveis de Retry
                if any(term in erro_str for term in ["429", "rate limit", "502", "503", "timeout", "timed out", "connection", "overloaded"]):
                    if attempt < max_retries - 1:
                        # Exponential backoff com Jitter: (2^attempt) + tempo sugerido pela OpenAI (se houver)
                        base_wait = (2 ** attempt) + np.random.uniform(1.0, 3.0)
                        
                        import re
                        match = re.search(r'try again in (\d+(?:\.\d+)?)s', erro_str)
                        if match:
                            base_wait = max(base_wait, float(match.group(1)) * 1.2)
                            
                        print(f"Rate Limit atingido no item {item.id}. Aguardando {base_wait:.2f}s (Tentativa {attempt+1}/{max_retries})...")
                        await asyncio.sleep(base_wait)
                        continue
                return {"id": item.id, "status": "ERRO", "erro": str(e)}

async def processar_real_ai(item: StatelessBatchItem, vector: list = None):
    # Short-circuit: Pular processamento inútil se for apenas um título de EAP
    if getattr(item, "is_macro_item", False):
        return {"id": item.id, "status": "MACRO_ITEM", "quantidade_original": 0.0, "descricao_original": item.descricao}
        
    descricao = item.descricao
    quantidade = item.quantidade
    
    if not descricao or str(descricao).strip() == "" or str(descricao).lower() == "nan":
        return {"id": item.id, "status": "TITULO_VAZIO", "quantidade_original": quantidade, "descricao_original": descricao}
        
    descricao_pesquisa = getattr(item, 'descricao_enriquecida', None) or descricao
    
    # Construção do RAG Contextual usando a descrição limpa
    busca_contextualizada = f"Etapa: {item.macro_etapa_pai} -> Serviço: {descricao_pesquisa}" if getattr(item, "macro_etapa_pai", "") else descricao_pesquisa
        
    try:
        tipo_item = getattr(item, 'tipo_item', 'SERVICO')
        matches = await buscar_verdadeiro_hibrido_async(busca_contextualizada, top_k=10, vector=vector, tipo_item=tipo_item)
        if not matches or matches[0]['score'] < 0.3:
            memoria_calculo = []
            for m in (matches or []):
                m_meta = m.get('metadata', {})
                memoria_calculo.append({
                    "codigo": str(m_meta.get("codigo", "")).replace('comp_', ''),
                    "descricao": m_meta.get("descricao", ""),
                    "unidade": m_meta.get("unidade", ""),
                    "custo": m_meta.get("custo", m_meta.get("preco", 0.0)),
                    "score": round(m.get('score', 0) * 100)
                })
                
            return {
                "id": item.id, 
                "status": "REJEITADO_FILTRO_MATEMATICO", 
                "justificativa": "Sem similaridade na base.", 
                "quantidade_original": quantidade, 
                "descricao_original": descricao,
                "memoria_calculo": memoria_calculo
            }
            
        analise = await fluxo_multi_agentes_mapeamento_async(item, matches)
        
        # Recuperar metadados do item selecionado para exibir no front (ignorando o prefixo comp_ se houver)
        codigo_selecionado = str(analise.codigo_selecionado).replace('comp_', '')
        meta = next((m['metadata'] for m in matches if str(m['id']).replace('comp_', '') == codigo_selecionado), {})
        
        # Limpa o código nos metadados para garantir que o front renderize apenas o número
        if 'codigo' in meta and isinstance(meta['codigo'], str):
            meta['codigo'] = meta['codigo'].replace('comp_', '')
            
        memoria_calculo = []
        for m in matches:
            m_meta = m.get('metadata', {})
            memoria_calculo.append({
                "codigo": str(m_meta.get("codigo", "")).replace('comp_', ''),
                "descricao": m_meta.get("descricao", ""),
                "unidade": m_meta.get("unidade", ""),
                "custo": m_meta.get("custo", m_meta.get("preco", 0.0)),
                "score": round(m.get('score', 0) * 100)
            })
        
        return {
            "id": item.id,
            "descricao_original": descricao,
            "quantidade_original": quantidade,
            "analise": analise.dict(),
            "metadados": meta,
            "memoria_calculo": memoria_calculo,
            "status": "SUCESSO"
        }
    except Exception as e:
        return {"id": item.id, "status": "ERRO", "erro": str(e), "quantidade_original": quantidade, "descricao_original": descricao}

async def processar_lote_stateless_async(itens: list[StatelessBatchItem], job_id: str = None):
    """Recebe um lote (chunk) enviado pelo frontend e processa sincronicamente ou em background emitindo SSE."""
    from services.ai_service import async_openai_client
    
    from services.ai_service import async_openai_client, corrigir_descricoes_lote_async
    
    async def run_task(item, vector):
        try:
            res = await process_item_with_semaphore(item, processar_real_ai, vector)
        except Exception as e:
            res = {"id": item.id, "status": "ERRO", "erro": f"Falha catastrófica no item: {str(e)}"}
            
        if job_id:
            await publish_sse_event(job_id, {"type": "item_processed", "data": res})
        return res

    all_tasks = []
    chunk_size = 50
    
    # Processamento em Chunks para Streaming real via SSE
    for i in range(0, len(itens), chunk_size):
        chunk_items = itens[i:i+chunk_size]
        
        # Filtra os válidos deste chunk
        valid_chunk = [it for it in chunk_items if str(it.descricao).strip() and str(it.descricao).lower() != "nan" and not getattr(it, "is_macro_item", False)]
        
        embeddings_map = {}
        
        if valid_chunk:
            payload_correcao = [{"id": it.id, "descricao_original": it.descricao} for it in valid_chunk]
            # 1. Normaliza o Chunk
            try:
                correcoes = await corrigir_descricoes_lote_async(payload_correcao) or {}
            except Exception as e:
                print(f"Erro no Batch Normalization do chunk: {str(e)}")
                correcoes = {}
            
            valid_texts = []
            for it in valid_chunk:
                dados_corrigidos = correcoes.get(it.id)
                if dados_corrigidos:
                    desc_enriquecida = dados_corrigidos.get("descricao_corrigida") or it.descricao
                    it.tipo_item = dados_corrigidos.get("tipo_item", "SERVICO")
                else:
                    desc_enriquecida = it.descricao
                    it.tipo_item = "SERVICO"
                it.descricao_enriquecida = desc_enriquecida
                valid_texts.append(desc_enriquecida)
            
            # 2. Gera Embeddings do Chunk
            if valid_texts:
                try:
                    res = await async_openai_client.embeddings.create(model="text-embedding-3-small", input=valid_texts)
                    for j, data in enumerate(res.data):
                        embeddings_map[valid_chunk[j].id] = data.embedding
                except Exception as e:
                    print(f"Erro no Batch Embedding do chunk: {str(e)}")
        
        # 3. Despacha tarefas de busca para todos os itens do chunk
        # As tarefas rodam em background (asyncio.create_task) enquanto o loop avança para o próximo chunk.
        # Isso permite que os itens comecem a ser finalizados e enviados via SSE quase instantaneamente!
        for it in chunk_items:
            vector = embeddings_map.get(it.id)
            all_tasks.append(asyncio.create_task(run_task(it, vector)))
            
    # Aguarda todas as tarefas finalizarem (blindado contra exceções não tratadas)
    resultados = await asyncio.gather(*all_tasks, return_exceptions=True)
    
    if job_id:
        await publish_sse_event(job_id, {"type": "job_completed"})
        
    return resultados
