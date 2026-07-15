from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from models.schemas import BatchRequest, ComposicaoRequest
from services.ai_service import buscar_verdadeiro_hibrido_async, fluxo_multi_agentes_mapeamento_async, gerar_composicao_agentes_async
from services.upload_service import start_upload_job, stream_job_progress, active_jobs
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
                 return {
                     "descricao_legada": descricao, 
                     "status": "REJEITADO_FILTRO_MATEMATICO", 
                     "analise": {"status": "REJEITADO", "codigo_selecionado": None, "justificativa": "Nenhuma correspondência semântica mínima encontrada na base SINAPI."}
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

@router.post("/orcamento/upload-lote")
async def upload_lote(file: UploadFile = File(...)):
    """Recebe a planilha Excel de 3000 linhas, joga pro processador assíncrono e devolve um Task ID."""
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Arquivo deve ser um Excel (.xlsx)")
        
    contents = await file.read()
    job_id = start_upload_job(contents)
    
    return {"status": "SUCESSO", "job_id": job_id, "message": "Iniciando processamento em background."}

@router.get("/orcamento/stream-lote/{job_id}")
async def stream_lote(job_id: str):
    """Conexão persistente (SSE) que envia a barra de progresso (0-100%) pro Frontend."""
    return StreamingResponse(stream_job_progress(job_id), media_type="text/event-stream")

@router.get("/orcamento/job/{job_id}/progress")
async def get_job_progress(job_id: str):
    """Endpoint de Smart Polling para buscar o status atual sem travar a conexão HTTP na Vercel."""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    
    job = active_jobs[job_id]
    return {
        "status": job["status"],
        "progress": job.get("progress", 0.0),
        "completed": job.get("completed", 0),
        "total": job.get("total", 0)
    }

@router.get("/orcamento/job/{job_id}/resultados")
async def get_job_resultados(job_id: str):
    """Busca os resultados finais armazenados em memória após a conclusão."""
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    job = active_jobs[job_id]
    if job["status"] != "FINALIZADO" and job["status"] != "ERRO":
         return {"status": job["status"], "message": "Processamento ainda em andamento"}
    return {"status": job["status"], "resultados": job.get("resultados", [])}


@router.post("/orcamento/gerar-composicao-ia")
async def gerar_composicao(request: ComposicaoRequest):
    """Gera uma Composição de Preço Unitário (CPU) inteira baseada na arquitetura Multi-Agentes."""
    try:
        # A nova arquitetura Multi-Agentes encapsula a busca e a geração em um só fluxo inteligente
        composicao_final = await gerar_composicao_agentes_async(request.servico)
        return {"status": "SUCESSO", "data": composicao_final}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
