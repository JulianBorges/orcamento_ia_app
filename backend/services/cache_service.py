import os
import json
import hashlib
import redis.asyncio as redis
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL")

# Singleton client
_redis_client = None

# Fallback em memória para SSE (usado para testes locais sem Redis)
_memory_queues = {}

def get_redis_client():
    global _redis_client
    if _redis_client is None and REDIS_URL:
        # Check if it's rediss:// (SSL) which is common for Upstash
        _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client

def _hash_key(prefix: str, content: str) -> str:
    md5 = hashlib.md5(content.strip().lower().encode('utf-8')).hexdigest()
    return f"{prefix}:{md5}"

async def get_semantic_cache(descricao: str):
    """Busca o resultado da IA no cache pelo MD5 da descrição."""
    client = get_redis_client()
    if not client:
        return None
    
    key = _hash_key("semantic_cache", descricao)
    try:
        cached = await client.get(key)
        if cached:
            return json.loads(cached)
    except Exception as e:
        print(f"Erro ao ler cache do Redis: {e}")
    return None

async def set_semantic_cache(descricao: str, resultado: dict, ttl_seconds: int = 1296000): # 15 dias
    """Salva o resultado da IA no cache com TTL."""
    client = get_redis_client()
    if not client:
        return
    
    key = _hash_key("semantic_cache", descricao)
    try:
        await client.set(key, json.dumps(resultado), ex=ttl_seconds)
    except Exception as e:
        print(f"Erro ao salvar cache no Redis: {e}")

async def publish_sse_event(job_id: str, event_data: dict):
    """Grava um evento no Stream durável do job_id."""
    client = get_redis_client()
    if client:
        try:
            stream_key = f"job_stream_{job_id}"
            await client.xadd(stream_key, {"data": json.dumps(event_data)})
            # Garante que o stream seja deletado automaticamente (cleanup)
            await client.expire(stream_key, 3600) # TTL de 1 hora
        except Exception as e:
            print(f"Erro no XADD do Redis Streams: {e}")
    else:
        # Fallback in-memory para desenvolvimento sem Redis local
        if job_id not in _memory_queues:
            _memory_queues[job_id] = []
        
        # Simula o ID timestamp-seq do Redis Stream
        fake_id = f"{len(_memory_queues[job_id])}-0"
        _memory_queues[job_id].append({"id": fake_id, "data": json.dumps(event_data)})

async def read_sse_stream(job_id: str, last_id: str = "0-0"):
    """Lê as mensagens do Stream do job_id bloqueando por até 15s (Heartbeat)."""
    client = get_redis_client()
    if client:
        try:
            stream_key = f"job_stream_{job_id}"
            # xread retorna: [[stream_name, [(msg_id, {fields}), ...]]]
            messages = await client.xread({stream_key: last_id}, count=100, block=15000)
            if messages:
                return messages[0][1] # Retorna a lista de tuplas [(msg_id, fields)]
            return []
        except Exception as e:
            print(f"Erro no XREAD do Redis Streams: {e}")
            import asyncio
            await asyncio.sleep(1) # Previne loop infinito silencioso
            return []
    else:
        # Fallback in-memory stream reader
        import asyncio
        stream = _memory_queues.get(job_id, [])
        
        try:
            start_idx = int(last_id.split("-")[0]) + 1 if last_id != "0-0" else 0
        except ValueError:
            start_idx = 0
            
        if start_idx < len(stream):
            msgs = stream[start_idx:start_idx+100]
            return [(m["id"], {"data": m["data"]}) for m in msgs]
            
        # Simula o block=15000 iterativamente
        for _ in range(15):
            await asyncio.sleep(1)
            if len(stream) > start_idx:
                msgs = stream[start_idx:start_idx+100]
                return [(m["id"], {"data": m["data"]}) for m in msgs]
        return []
