import asyncio
import pandas as pd
import numpy as np
import io
import uuid
from typing import Dict, Any
from services.ai_service import buscar_verdadeiro_hibrido_async, fluxo_multi_agentes_mapeamento_async

# In-memory store para os jobs de processamento (MVP). Em prod: Redis.
active_jobs: Dict[str, Any] = {}

# Semáforo global para não estourar os limites de concorrência da OpenAI
openai_semaphore = asyncio.Semaphore(5)

async def process_item_with_semaphore(item: dict, ai_function, *args):
    """Executa uma função de IA respeitando o limite do semáforo com retentativas (Retry Logic)."""
    max_retries = 3
    async with openai_semaphore:
        for attempt in range(max_retries):
            try:
                # Simulando o tempo de rede e limitando rate limits
                await asyncio.sleep(0.5) 
                resultado = await ai_function(item, *args)
                
                # Se a função interna retornou ERRO por Rate Limit, lançamos a exceção para ativar o Retry
                if isinstance(resultado, dict) and resultado.get("status") == "ERRO":
                    erro_str = resultado.get("erro", "").lower()
                    if "429" in erro_str or "rate limit" in erro_str or "502" in erro_str or "503" in erro_str:
                        raise Exception(f"RateLimit ou Timeout: {erro_str}")
                    else:
                        # Se for um erro técnico de sintaxe ou banco, não adianta tentar de novo
                        return {"id": item.get('id', 'N/A'), "status": "ERRO", "erro": resultado.get("erro")}
                
                return {"id": item.get('id', 'N/A'), "status": "SUCESSO", "resultado": resultado}
            
            except Exception as e:
                erro_str = str(e).lower()
                if "429" in erro_str or "rate limit" in erro_str or "502" in erro_str or "503" in erro_str:
                    if attempt < max_retries - 1:
                        # Exponential backoff: espera 2, 4, 8 segundos
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                return {"id": item.get('id', 'N/A'), "status": "ERRO", "erro": str(e)}

async def background_batch_processor(job_id: str, df: pd.DataFrame, ai_function, *args):
    """Roda em background fatiando o DataFrame e reportando o progresso no active_jobs."""
    total_items = len(df)
    active_jobs[job_id]["total"] = total_items
    
    # Prepara as tasks em paralelo mantendo a ordem correta
    resultados_finais = [None] * total_items
    
    async def run_task(idx, row):
        res = await process_item_with_semaphore(row, ai_function, *args)
        return idx, res
        
    tasks = [
        asyncio.create_task(run_task(idx, row))
        for idx, row in enumerate(df.to_dict('records'))
    ]
    
    # Processa conforme o Semáforo permite e atualiza o progresso usando as_completed
    completed = 0
    
    for future in asyncio.as_completed(tasks):
        idx, result = await future
        resultados_finais[idx] = result
        completed += 1
        
        # Atualiza o estado
        active_jobs[job_id]["completed"] = completed
        active_jobs[job_id]["progress"] = round((completed / total_items) * 100, 2)
        
    active_jobs[job_id]["status"] = "FINALIZADO"
    active_jobs[job_id]["resultados"] = resultados_finais

def start_upload_job(file_bytes: bytes) -> str:
    # Lemos a planilha em memória usando Pandas
    df = pd.read_excel(io.BytesIO(file_bytes))
    
    # Substitui valores NaN/NaT por None para permitir serialização JSON limpa no FastAPI
    df = df.replace({np.nan: None})
    
    # Identifica a coluna da descrição dinamicamente
    desc_col = None
    for col in df.columns:
        if str(col).lower() in ['descricao', 'descrição', 'servico', 'serviço', 'nome']:
            desc_col = col
            break
    if not desc_col:
        desc_col = df.columns[0] # Fallback para a primeira coluna
        
    df = df.rename(columns={desc_col: 'descricao'})
    
    # Identifica a coluna da quantidade
    quant_col = None
    for col in df.columns:
        if str(col).lower() in ['quant', 'quantidade', 'qtd', 'qnt']:
            quant_col = col
            break
    if quant_col:
        df = df.rename(columns={quant_col: 'quantidade'})
    else:
        df['quantidade'] = 1.0
        
    job_id = str(uuid.uuid4())
    
    active_jobs[job_id] = {
        "status": "PROCESSANDO",
        "progress": 0.0,
        "completed": 0,
        "total": len(df),
        "resultados": []
    }
    # Função que faz a ponte real com a Inteligência
    async def processar_real_ai(row_data, *args):
        descricao = row_data.get('descricao', '')
        quantidade = row_data.get('quantidade')
        
        # Garante que quantidade seja número válido
        if quantidade is None or str(quantidade).strip() == "":
            quantidade = 1.0
        else:
            try:
                quantidade = float(quantidade)
            except (ValueError, TypeError):
                quantidade = 1.0
                
        if not descricao or str(descricao).strip() == "" or str(descricao).lower() == "nan":
            return {"status": "TITULO_VAZIO", "quantidade_original": quantidade}
            
        try:
            matches = await buscar_verdadeiro_hibrido_async(descricao, top_k=5)
            if not matches or matches[0]['score'] < 0.3:
                return {"status": "REJEITADO_FILTRO_MATEMATICO", "justificativa": "Sem similaridade na base.", "quantidade_original": quantidade, "descricao_original": descricao}
                
            analise = await fluxo_multi_agentes_mapeamento_async(descricao, matches)
            
            # Recuperar metadados do item selecionado para exibir no front (ignorando o prefixo comp_ se houver)
            codigo_selecionado = str(analise.codigo_selecionado).replace('comp_', '')
            meta = next((m['metadata'] for m in matches if str(m['id']).replace('comp_', '') == codigo_selecionado), {})
            
            # Limpa o código nos metadados para garantir que o front renderize apenas o número
            if 'codigo' in meta and isinstance(meta['codigo'], str):
                meta['codigo'] = meta['codigo'].replace('comp_', '')
            
            return {
                "descricao_original": descricao,
                "quantidade_original": quantidade,
                "analise": analise.dict(),
                "metadados": meta
            }
        except Exception as e:
            return {"status": "ERRO", "erro": str(e), "quantidade_original": quantidade, "descricao_original": descricao}
        
    # Dispara a task real pro loop de eventos sem travar a request HTTP
    asyncio.create_task(background_batch_processor(job_id, df, processar_real_ai))
    
    return job_id

async def stream_job_progress(job_id: str):
    """Generator assíncrono para Server-Sent Events (SSE)."""
    if job_id not in active_jobs:
        yield f"data: {{\"error\": \"Job não encontrado\"}}\n\n"
        return
        
    while True:
        job = active_jobs[job_id]
        
        # Envia os dados atuais como JSON SSE
        import json
        payload = json.dumps({
            "status": job["status"],
            "progress": job["progress"],
            "completed": job["completed"],
            "total": job["total"]
        })
        yield f"data: {payload}\n\n"
        
        if job["status"] in ["FINALIZADO", "ERRO"]:
            break
            
        # Espera 1 segundo antes de checar novamente (Tick do Stream)
        await asyncio.sleep(1)
