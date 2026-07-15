import asyncio
import os
import sys

# Add backend to path
sys.path.insert(0, r"C:\Users\Julian\orcamento_ia_app_V2 - Vercel\backend")

from services.upload_service import process_item_with_semaphore

async def test_ai():
    # Define a fake ai function that just throws an error or we can use the real one
    from services.upload_service import active_jobs
    import pandas as pd
    
    # We will just run the ai_service directly
    from services.ai_service import buscar_semelhantes_pinecone_async, fluxo_multi_agentes_mapeamento_async
    
    try:
        matches = await buscar_semelhantes_pinecone_async("Tubo PVC 50mm", top_k=5)
        print("Matches found:", len(matches))
        analise = await fluxo_multi_agentes_mapeamento_async("Tubo PVC 50mm", matches)
        print("Analise:", analise.dict())
    except Exception as e:
        print("ERROR OCCURRED:", repr(e))

if __name__ == "__main__":
    asyncio.run(test_ai())
