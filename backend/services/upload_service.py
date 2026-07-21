import asyncio
import pandas as pd
import numpy as np
import io
import uuid
from typing import Dict, Any
from services.ai_service import buscar_verdadeiro_hibrido_async, fluxo_multi_agentes_mapeamento_async

from models.schemas import StatelessBatchItem

# Semáforo global para concorrência da OpenAI
# Reduzido para 30 para equilibrar throughput e evitar Rate Limits pesados (Fail-Fast Serverless)
openai_semaphore = asyncio.Semaphore(30)

async def process_item_with_semaphore(item: StatelessBatchItem, ai_function, *args):
    """Executa uma função de IA respeitando o limite do semáforo com retentativas (Retry Logic adaptada para Vercel Hobby)."""
    max_retries = 2
    async with openai_semaphore:
        for attempt in range(max_retries):
            try:
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
                        # Fail-Fast Backoff (1.5s) para não estourar o limite de 10s da Vercel Hobby
                        await asyncio.sleep(1.5 * (attempt + 1))
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
        matches = await buscar_verdadeiro_hibrido_async(busca_contextualizada, top_k=7, vector=vector)
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

async def processar_lote_stateless_async(itens: list[StatelessBatchItem]):
    """Recebe um lote (chunk) enviado pelo frontend e processa sincronicamente usando batch de embeddings para máxima performance."""
    from services.ai_service import async_openai_client
    
    # 1. Filtra itens validos para evitar tokens desnecessários
    valid_items = []
    
    for item in itens:
        desc = str(item.descricao).strip()
        if desc and desc.lower() != "nan":
            valid_items.append(item)
            
    # 1.5 Correção e Enriquecimento em Lote (Agente Normalizador) com Chunking
    from services.ai_service import corrigir_descricoes_lote_async
    
    payload_correcao = [{"id": it.id, "descricao_original": it.descricao} for it in valid_items]
    correcoes = {}
    
    normalizer_semaphore = asyncio.Semaphore(5)
    
    async def process_norm_chunk(chunk):
        async with normalizer_semaphore:
            return await corrigir_descricoes_lote_async(chunk)
            
    norm_tasks = []
    chunk_size_norm = 50
    for i in range(0, len(payload_correcao), chunk_size_norm):
        chunk = payload_correcao[i:i + chunk_size_norm]
        norm_tasks.append(process_norm_chunk(chunk))
        
    resultados_norm = await asyncio.gather(*norm_tasks)
    for r in resultados_norm:
        if r:
            correcoes.update(r)
    
    valid_texts = []
    for it in valid_items:
        # Usa a corrigida se disponível, senão fallback para original
        desc_enriquecida = correcoes.get(it.id) or it.descricao
        it.descricao_enriquecida = desc_enriquecida
        valid_texts.append(desc_enriquecida)
            
    # 2. Gera todos os Embeddings do Lote com Chunking
    embeddings_map = {}
    if valid_texts:
        emb_semaphore = asyncio.Semaphore(10)
        
        async def process_emb_chunk(chunk_texts, chunk_items):
            async with emb_semaphore:
                try:
                    res = await async_openai_client.embeddings.create(model="text-embedding-3-small", input=chunk_texts)
                    return {chunk_items[j].id: data.embedding for j, data in enumerate(res.data)}
                except Exception as e:
                    print(f"Erro no Batch Embedding: {str(e)}")
                    return {}
                    
        emb_tasks = []
        chunk_size_emb = 100
        for i in range(0, len(valid_texts), chunk_size_emb):
            chunk_texts = valid_texts[i:i + chunk_size_emb]
            chunk_items = valid_items[i:i + chunk_size_emb]
            emb_tasks.append(process_emb_chunk(chunk_texts, chunk_items))
            
        resultados_emb = await asyncio.gather(*emb_tasks)
        for r in resultados_emb:
            if r:
                embeddings_map.update(r)
    
    # 3. Processa
    async def run_task(item):
        vector = embeddings_map.get(item.id)
        res = await process_item_with_semaphore(item, processar_real_ai, vector)
        return res

    tasks = [asyncio.create_task(run_task(it)) for it in itens]
    resultados = await asyncio.gather(*tasks)
    return resultados
