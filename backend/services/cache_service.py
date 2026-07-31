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
    """Publica um evento no canal do job_id."""
    client = get_redis_client()
    if client:
        try:
            await client.publish(f"job_{job_id}", json.dumps(event_data))
        except Exception as e:
            print(f"Erro no Pub/Sub do Redis: {e}")
    else:
        # Fallback in-memory
        if job_id in _memory_queues:
            for q in _memory_queues[job_id]:
                await q.put({"type": "message", "data": json.dumps(event_data)})

async def subscribe_sse_events(job_id: str):
    """Assina o canal do job_id para o SSE."""
    client = get_redis_client()
    if not client:
        import asyncio
        # Fallback in-memory (Mock do PubSub object)
        if job_id not in _memory_queues:
            _memory_queues[job_id] = []
        q = asyncio.Queue()
        _memory_queues[job_id].append(q)
        
        class MemoryPubSub:
            async def listen(self):
                while True:
                    msg = await q.get()
                    yield msg
                    
        return MemoryPubSub()
    
    pubsub = client.pubsub()
    await pubsub.subscribe(f"job_{job_id}")
    return pubsub
