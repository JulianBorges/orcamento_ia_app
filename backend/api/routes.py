from fastapi import APIRouter, HTTPException
from models.schemas import BatchRequest, ComposicaoRequest, StatelessBatchRequest, EAPGenerationRequest
from services.ai_service import buscar_verdadeiro_hibrido_async, fluxo_multi_agentes_mapeamento_async, gerar_composicao_agentes_async, gerar_eap_inteligente_async
from services.upload_service import processar_lote_stateless_async
import asyncio

router = APIRouter()

@router.get("/sinapi/search")
async def search_sinapi(q: str):
    """Busca manual no SINAPI para o autocomplete e menu suspenso do Frontend."""
    try:
        matches = await buscar_verdadeiro_hibrido_async(q, top_k=10)
        return {"results": [{"codigo": str(m['id']).replace('comp_', ''), "score": m['score'], **m['metadata']} for m in matches]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/orcamento/processar-lote")
async def processar_lote(request: BatchRequest):
    """Processa dezenas de itens simultaneamente (Assíncrono/Batching)."""
    
    async def processar_unico(descricao: str):
        descricao = descricao.strip()
        if not descricao or str(descricao).lower() == "nan":
            return {"descricao_legada": descricao, "status": "TITULO_VAZIO", "analise": None}
        
        try:
            matches = await buscar_verdadeiro_hibrido_async(descricao, top_k=10)
            
            # Filtro Matemático (Score do Pinecone: 1.0 é idêntico. Menor que 0.3 = lixo).
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
                     "descricao_legada": descricao, 
                     "status": "REJEITADO_FILTRO_MATEMATICO", 
                     "analise": {"status": "REJEITADO", "codigo_selecionado": None, "justificativa": "Nenhuma correspondência semântica mínima encontrada na base SINAPI."},
                     "memoria_calculo": memoria_calculo
                 }
                
            analise = await fluxo_multi_agentes_mapeamento_async(descricao, matches)
            
            # Recuperar metadados do item selecionado pela IA
            codigo_selecionado = str(analise.codigo_selecionado).replace('comp_', '')
            metadados_selecionados = next((m['metadata'] for m in matches if str(m['id']).replace('comp_', '') == codigo_selecionado), {})
            
            if 'codigo' in metadados_selecionados and isinstance(metadados_selecionados['codigo'], str):
                metadados_selecionados['codigo'] = metadados_selecionados['codigo'].replace('comp_', '')
            
            return {
                "descricao_legada": descricao,
                "status": "PROCESSADO",
                "analise": analise.dict(),
                "metadados": metadados_selecionados
            }
        except Exception as e:
            return {"descricao_legada": descricao, "status": "ERRO", "erro": str(e)}

    # Roda todas as requisições em paralelo no Event Loop! O tempo cai de Minutos para Segundos.
    tarefas = [processar_unico(desc) for desc in request.descriptions]
    resultados = await asyncio.gather(*tarefas)
    
    return {"resultados": resultados}

@router.post("/orcamento/processar-lote-stateless")
async def processar_lote_stateless(request: StatelessBatchRequest):
    """Recebe um lote (chunk) e processa de forma síncrona/stateless, devolvendo os resultados."""
    if not request.itens:
        return {"resultados": []}
        
    try:
        # Passa os itens para a camada de serviço que lida com o semáforo de concorrência
        resultados = await processar_lote_stateless_async(request.itens)
        return {"status": "SUCESSO", "resultados": resultados}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/orcamento/gerar-composicao-ia")
async def gerar_composicao(request: ComposicaoRequest):
    """Gera uma Composição de Preço Unitário (CPU) inteira baseada na arquitetura Multi-Agentes."""
    try:
        # A nova arquitetura Multi-Agentes encapsula a busca e a geração em um só fluxo inteligente
        composicao_final = await gerar_composicao_agentes_async(request.servico)
        return {"status": "SUCESSO", "data": composicao_final}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/orcamento/estruturar-eap")
async def estruturar_eap(request: EAPGenerationRequest):
    """Agrupa lista plana de serviços em Macro-etapas de engenharia usando GPT-4o-mini estruturado."""
    try:
        resultado = await gerar_eap_inteligente_async(request)
        return {"status": "SUCESSO", "data": resultado}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
