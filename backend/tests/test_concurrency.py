import asyncio
import os
import sys

sys.path.insert(0, r"C:\Users\Julian\orcamento_ia_app_V2 - Vercel\backend")

from services.upload_service import active_jobs
import pandas as pd
from services.ai_service import buscar_verdadeiro_hibrido_async, fluxo_multi_agentes_mapeamento_async

async def worker(item):
    try:
        matches = await buscar_verdadeiro_hibrido_async(item, top_k=5)
        analise = await fluxo_multi_agentes_mapeamento_async(item, matches)
        return {"status": "SUCESSO", "analise": analise.dict()}
    except Exception as e:
        return {"status": "ERRO", "erro": repr(e)}

async def test_ai():
    items = ["Tubo PVC 50mm"] * 10
    tasks = [worker(item) for item in items]
    results = await asyncio.gather(*tasks)
    
    for r in results:
        print(r)

if __name__ == "__main__":
    asyncio.run(test_ai())
