import asyncio
import pandas as pd
import numpy as np
import io
import uuid
from typing import Dict, Any
from services.ai_service import buscar_verdadeiro_hibrido_async, fluxo_multi_agentes_mapeamento_async

from models.schemas import StatelessBatchItem

# Semáforo global para não estourar os limites de concorrência da OpenAI (RPM)
# Reduzido para 5 para garantir que a IA processe lotes massivos (+5000) sem falhar.
openai_semaphore = asyncio.Semaphore(5)

async def process_item_with_semaphore(item: StatelessBatchItem, ai_function, *args):
    """Executa uma função de IA respeitando o limite do semáforo com retentativas (Retry Logic)."""
    max_retries = 6
    async with openai_semaphore:
        for attempt in range(max_retries):
            try:
                # Simulando o tempo de rede e limitando rate limits
                await asyncio.sleep(0.5) 
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
                        # Exponential backoff agressivo para salvar jobs grandes
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                return {"id": item.id, "status": "ERRO", "erro": str(e)}

async def processar_real_ai(item: StatelessBatchItem):
    descricao = item.descricao
    quantidade = item.quantidade
    
    if not descricao or str(descricao).strip() == "" or str(descricao).lower() == "nan":
        return {"id": item.id, "status": "TITULO_VAZIO", "quantidade_original": quantidade, "descricao_original": descricao}
        
    try:
        matches = await buscar_verdadeiro_hibrido_async(descricao, top_k=5)
        if not matches or matches[0]['score'] < 0.3:
            return {"id": item.id, "status": "REJEITADO_FILTRO_MATEMATICO", "justificativa": "Sem similaridade na base.", "quantidade_original": quantidade, "descricao_original": descricao}
            
        analise = await fluxo_multi_agentes_mapeamento_async(item, matches)
        
        # Recuperar metadados do item selecionado para exibir no front (ignorando o prefixo comp_ se houver)
        codigo_selecionado = str(analise.codigo_selecionado).replace('comp_', '')
        meta = next((m['metadata'] for m in matches if str(m['id']).replace('comp_', '') == codigo_selecionado), {})
        
        # Limpa o código nos metadados para garantir que o front renderize apenas o número
        if 'codigo' in meta and isinstance(meta['codigo'], str):
            meta['codigo'] = meta['codigo'].replace('comp_', '')
            
        top_3_matches = []
        for m in matches[:3]:
            m_meta = m.get('metadata', {})
            top_3_matches.append({
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
            "top_3_matches": top_3_matches,
            "status": "SUCESSO"
        }
    except Exception as e:
        return {"id": item.id, "status": "ERRO", "erro": str(e), "quantidade_original": quantidade, "descricao_original": descricao}

async def processar_lote_stateless_async(itens: list[StatelessBatchItem]):
    """Recebe um lote (chunk) enviado pelo frontend e processa sincronicamente usando o semáforo interno."""
    
    async def run_task(item):
        res = await process_item_with_semaphore(item, processar_real_ai)
        return res

    tasks = [asyncio.create_task(run_task(it)) for it in itens]
    resultados = await asyncio.gather(*tasks)
    return resultados
