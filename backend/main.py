from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.security.api_key import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from api.routes import router as api_router

load_dotenv()

API_KEY = os.getenv("API_SECRET_KEY", "chave-secreta-padrao")
api_key_header = APIKeyHeader(name="x-api-key", auto_error=True)

async def verify_api_key(api_key_header: str = Security(api_key_header)):
    if api_key_header != API_KEY:
        raise HTTPException(status_code=401, detail="Could not validate API key")

app = FastAPI(title="Copiloto de Engenharia API")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

# Configure CORS for the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api", dependencies=[Depends(verify_api_key)])

@app.get("/")
def read_root():
    return {"message": "Bem-vindo à API do Copiloto de Engenharia"}

@app.get("/api/health")
def health_check():
    return {"status": "online"}
