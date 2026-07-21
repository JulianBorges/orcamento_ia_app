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
        
    # Construção do RAG Contextual
    busca_contextualizada = f"Etapa: {item.macro_etapa_pai} -> Serviço: {descricao}" if getattr(item, "macro_etapa_pai", "") else descricao
        
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
    valid_texts = []
    
    for item in itens:
        desc = str(item.descricao).strip()
        if desc and desc.lower() != "nan":
            valid_items.append(item)
            valid_texts.append(desc)
            
    # 2. Gera todos os Embeddings do Lote inteiro numa única requisição (Economiza 50x de Requests)
    embeddings_map = {}
    if valid_texts:
        try:
            # Batching embedding API
            res = await async_openai_client.embeddings.create(model="text-embedding-3-small", input=valid_texts)
            for i, data in enumerate(res.data):
                embeddings_map[valid_items[i].id] = data.embedding
        except Exception as e:
            print(f"Erro no Batch Embedding: {str(e)}")
            # Se falhar o lote, as funções internas ainda tentarão item por item, pois `vector=None`
    
    # 3. Processa
    async def run_task(item):
        vector = embeddings_map.get(item.id)
        res = await process_item_with_semaphore(item, processar_real_ai, vector)
        return res

    tasks = [asyncio.create_task(run_task(it)) for it in itens]
    resultados = await asyncio.gather(*tasks)
    return resultados
